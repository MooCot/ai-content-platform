import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EvaluationRecordEntity } from './entities/evaluation-record.entity';
import { RelevanceEvaluator } from './evaluators/relevance.evaluator';
import { ToneEvaluator } from './evaluators/tone.evaluator';
import { FactualityEvaluator } from './evaluators/factuality.evaluator';
import { CompositeEvaluator } from './evaluators/composite.evaluator';
import { MemoryService, RecordMemoryParams } from '../memory/memory.service';
import { MetricsService } from '../observability/metrics.service';
import { AgentContext } from '../agents/context/agent-context';
import { ContentResult, AgentRole } from '../common/types/domain.types';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../common/config/configuration';
import { EvaluationResultContractV1 } from '../contracts';

/** Semver hash of the current prompt set — bump when prompts change. */
const PROMPT_VERSION = '1.0.0';

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);
  private readonly memoryIndexingThreshold: number;

  constructor(
    @InjectRepository(EvaluationRecordEntity)
    private readonly evalRepo: Repository<EvaluationRecordEntity>,
    private readonly relevance: RelevanceEvaluator,
    private readonly tone: ToneEvaluator,
    private readonly factuality: FactualityEvaluator,
    private readonly composite: CompositeEvaluator,
    private readonly memory: MemoryService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.memoryIndexingThreshold = this.config.get('evaluation.memoryIndexingThreshold', {
      infer: true,
    });
  }

  /**
   * Score a completed generation and persist the evaluation record.
   * Also writes a memory event and conditionally indexes it in Qdrant.
   *
   * Designed to be called fire-and-forget (void, no await from caller).
   * Never throws — all errors are logged and swallowed.
   */
  async evaluate(ctx: AgentContext, result: ContentResult): Promise<void> {
    const jobId = ctx.jobId;
    const finalContent = result.optimized || result.raw;

    this.logger.log(`[${jobId}] Starting evaluation`);

    try {
      // Run dimension scorers in parallel — each degrades gracefully on error
      const [
        relevanceScore,
        { score: toneScore, detected: detectedTone },
        { score: factualityScore, supportedClaims, totalClaims },
      ] = await Promise.all([
        this.relevance.score(ctx.topic, finalContent),
        this.tone.score(ctx.targetTone, finalContent),
        this.factuality.score(finalContent, ctx.ragContext),
      ]);

      const readabilityScore = result.readabilityScore / 100; // normalize 0–100 → 0–1

      const compositeScore = this.composite.score({
        relevance: relevanceScore,
        tone: toneScore,
        factuality: factualityScore,
        readability: readabilityScore,
      });

      // Determine model from the last recorded agent step
      const lastStep = ctx.steps[ctx.steps.length - 1];
      const modelId = lastStep?.modelUsed ?? 'unknown';

      const payload = {
        jobId,
        brandId: ctx.brandId,
        contentType: ctx.contentType,
        modelId,
        promptVersion: PROMPT_VERSION,
        relevanceScore,
        toneScore,
        factualityScore,
        readabilityScore,
        compositeScore,
        dimensions: {
          relevance: { score: relevanceScore },
          tone: { score: toneScore, detected: detectedTone, target: ctx.targetTone },
          factuality: { score: factualityScore, supportedClaims, totalClaims },
          readability: { score: readabilityScore },
        },
      };

      // Contract gate: validate evaluation payload before persisting.
      // Catches score normalisation drift (e.g. score > 1 from a mis-weighted evaluator).
      // Runs inside the try/catch so a violation logs and exits gracefully.
      const contractCheck = EvaluationResultContractV1.safeParse(payload);
      if (!contractCheck.success) {
        const issues = contractCheck.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        this.logger.error(`[${jobId}] Evaluation contract violation — record not saved: ${issues}`);
        return;
      }

      const record = this.evalRepo.create(payload);
      await this.evalRepo.save(record);

      this.logger.log(
        `[${jobId}] Evaluation complete: composite=${compositeScore.toFixed(3)} ` +
          `(R=${relevanceScore.toFixed(2)}, T=${toneScore.toFixed(2)}, ` +
          `F=${factualityScore.toFixed(2)}, Re=${readabilityScore.toFixed(2)})`,
      );

      this.metrics.recordEvaluationScore(ctx.brandId, ctx.contentType, modelId, compositeScore);

      // ── Memory write ──────────────────────────────────────────────────────────
      const memoryParams: RecordMemoryParams = {
        brandId: ctx.brandId,
        jobId,
        agent: AgentRole.QA,
        eventType: 'generation_complete',
        content: finalContent.slice(0, 2000), // cap stored content size
        payload: {
          topic: ctx.topic,
          contentType: ctx.contentType,
          compositeScore,
          wordCount: result.wordCount,
          modelId,
          promptVersion: PROMPT_VERSION,
        },
        promptVersion: PROMPT_VERSION,
      };

      const memoryEvent = await this.memory.record(memoryParams);

      // Only index high-quality generations for future recall
      if (compositeScore >= this.memoryIndexingThreshold) {
        await this.memory.embedAndIndex(memoryEvent.id, finalContent, ctx.brandId);
        this.logger.debug(
          `[${jobId}] Memory indexed (score=${compositeScore.toFixed(3)} >= threshold)`,
        );
      } else {
        this.logger.debug(
          `[${jobId}] Memory NOT indexed (score=${compositeScore.toFixed(3)} < threshold=${this.memoryIndexingThreshold})`,
        );
      }
    } catch (err) {
      // Evaluation must never crash the system
      this.logger.error(`[${jobId}] Evaluation pipeline error: ${String(err)}`);
    }
  }

  /** Retrieve evaluation records for a brand, newest first. */
  async getByBrand(brandId: string, limit = 50): Promise<EvaluationRecordEntity[]> {
    return this.evalRepo.find({
      where: { brandId },
      order: { evaluatedAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Compare average composite scores between two model IDs for a brand.
   * Useful for A/B testing prompt or model changes.
   */
  async compareModels(
    brandId: string,
    modelA: string,
    modelB: string,
  ): Promise<{ modelA: number; modelB: number; winner: string }> {
    const avg = async (modelId: string): Promise<number> => {
      const records = await this.evalRepo.find({
        where: { brandId, modelId },
        order: { evaluatedAt: 'DESC' },
        take: 100,
      });
      if (!records.length) return 0;
      return records.reduce((s, r) => s + r.compositeScore, 0) / records.length;
    };

    const [scoreA, scoreB] = await Promise.all([avg(modelA), avg(modelB)]);
    return {
      modelA: parseFloat(scoreA.toFixed(4)),
      modelB: parseFloat(scoreB.toFixed(4)),
      winner: scoreA >= scoreB ? modelA : modelB,
    };
  }
}
