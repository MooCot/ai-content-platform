import { Injectable, Logger, Optional } from '@nestjs/common';
import { AgentContext } from '../context/agent-context';
import { PlannerAgent } from '../agents/planner.agent';
import { ResearcherAgent } from '../agents/researcher.agent';
import { GeneratorAgent } from '../agents/generator.agent';
import { OptimizerAgent } from '../agents/optimizer.agent';
import { QAAgent } from '../agents/qa.agent';
import { StreamingService } from '../../streaming/streaming.service';
import { AgentRole, ContentResult } from '../../common/types/domain.types';
import { ContentResultContractV1 } from '../../contracts';
import { ContractViolationException } from '../../common/exceptions/domain.exceptions';
import { DegradationService } from '../../resilience/degradation.service';

// Per-agent timeout budgets (ms). Generator gets the most time because it streams.
const AGENT_TIMEOUTS: Record<AgentRole, number> = {
  [AgentRole.PLANNER]: 30_000,
  [AgentRole.RESEARCHER]: 20_000,
  [AgentRole.GENERATOR]: 120_000,
  [AgentRole.OPTIMIZER]: 60_000,
  [AgentRole.QA]: 60_000,
};

// Agents that can be skipped when the pipeline is degraded or the latency
// budget is exhausted. Required agents (PLANNER, RESEARCHER, GENERATOR)
// always run — their failure propagates and marks the job FAILED.
const OPTIONAL_AGENTS = new Set<AgentRole>([AgentRole.OPTIMIZER, AgentRole.QA]);

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  private readonly pipeline: AgentRole[] = [
    AgentRole.PLANNER,
    AgentRole.RESEARCHER,
    AgentRole.GENERATOR,
    AgentRole.OPTIMIZER,
    AgentRole.QA,
  ];

  constructor(
    private readonly planner: PlannerAgent,
    private readonly researcher: ResearcherAgent,
    private readonly generator: GeneratorAgent,
    private readonly optimizer: OptimizerAgent,
    private readonly qa: QAAgent,
    private readonly streaming: StreamingService,
    // Optional so existing unit tests that don't provide this service still pass
    @Optional() private readonly degradationService?: DegradationService,
  ) {}

  async run(ctx: AgentContext): Promise<ContentResult> {
    this.logger.log(`[${ctx.jobId}] Pipeline starting: ${this.pipeline.join(' → ')}`);
    const pipelineStart = Date.now();

    const agents: Record<AgentRole, () => Promise<void>> = {
      [AgentRole.PLANNER]: () => this.planner.run(ctx),
      [AgentRole.RESEARCHER]: () => this.researcher.run(ctx),
      [AgentRole.GENERATOR]: () => this.generator.run(ctx),
      [AgentRole.OPTIMIZER]: () => this.optimizer.run(ctx),
      [AgentRole.QA]: () => this.qa.run(ctx),
    };

    for (const role of this.pipeline) {
      if (ctx.isCancelled) {
        this.logger.warn(`[${ctx.jobId}] Pipeline cancelled before ${role}`);
        break;
      }

      const isOptional = OPTIONAL_AGENTS.has(role);
      const elapsed = Date.now() - pipelineStart;

      // Skip optional agents when already degraded or latency budget is blown
      if (isOptional && this.shouldSkipOptional(ctx, elapsed)) {
        ctx.degradation.append('optional_agent_skipped');
        this.logger.warn(
          `[${ctx.jobId}] Skipping optional agent ${role} (degraded=${ctx.degradation.isDegraded}, elapsed=${elapsed}ms)`,
        );
        continue;
      }

      this.streaming.emit(ctx.jobId, {
        type: 'agent_start',
        data: { agent: role },
        jobId: ctx.jobId,
      });

      if (isOptional) {
        // Optional agents get one automatic retry before the pipeline continues degraded
        await this.runWithRetry(role, agents[role], ctx);
      } else {
        await this.withTimeout(role, agents[role]());
      }

      const lastStep = ctx.steps[ctx.steps.length - 1];
      this.streaming.emit(ctx.jobId, {
        type: 'agent_done',
        data: { agent: role, durationMs: lastStep?.durationMs },
        jobId: ctx.jobId,
      });
    }

    // Content fallbacks for skipped optional agents:
    //   optimized → falls back to raw draft when Optimizer was skipped
    //   word count → derived from the richest available text
    const finalText = ctx.finalContent || ctx.optimizedContent || ctx.draftContent;
    const rawResult = {
      raw: ctx.draftContent,
      optimized: ctx.optimizedContent || ctx.draftContent,
      seoKeywords: ctx.seoKeywords,
      readabilityScore: ctx.readabilityScore,
      toneAnalysis: {
        detected: ctx.targetTone,
        confidence: 0.9,
        scores: {} as ContentResult['toneAnalysis']['scores'],
      },
      wordCount: finalText.split(/\s+/).filter(Boolean).length,
      citations: ctx.citations,
      degraded: ctx.degradation.isDegraded,
      degradationReasons: [...ctx.degradation.reasons],
    };

    // Contract gate: validate the assembled result before returning it to the
    // processor. Catches schema drift between agents and the persistence layer.
    const parsed = ContentResultContractV1.safeParse(rawResult);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      this.logger.error(`[${ctx.jobId}] ContentResult contract violation: ${issues}`);
      throw new ContractViolationException('ContentResultV1', issues);
    }

    if (ctx.degradation.isDegraded) {
      this.logger.warn(
        `[${ctx.jobId}] Pipeline complete (degraded) — reasons: [${ctx.degradation.reasons.join(', ')}]`,
      );
    } else {
      this.logger.log(`[${ctx.jobId}] Pipeline complete`);
    }

    return parsed.data as ContentResult;
  }

  /**
   * Returns true when optional agents should be skipped.
   * Checks two independent conditions — either is sufficient:
   *  1. Pipeline is already in degraded mode (e.g. RAG timed out, queue overloaded)
   *  2. Latency budget has been consumed
   */
  private shouldSkipOptional(ctx: AgentContext, elapsedMs: number): boolean {
    if (ctx.degradation.isDegraded) return true;
    return this.degradationService?.isLatencyBudgetExceeded(elapsedMs) ?? false;
  }

  /**
   * Run an optional agent with a single retry on any failure.
   * If both attempts fail, appends `optional_agent_skipped` and returns —
   * the pipeline continues with whatever content was produced so far.
   *
   * `contract_retry` is recorded on the first failure so the processor can
   * emit the matching Prometheus label even when the retry succeeds.
   */
  private async runWithRetry(
    role: AgentRole,
    task: () => Promise<void>,
    ctx: AgentContext,
  ): Promise<void> {
    try {
      await this.withTimeout(role, task());
    } catch (firstErr) {
      this.logger.warn(`[${ctx.jobId}] ${role} failed — retrying once: ${String(firstErr)}`);
      ctx.degradation.append('contract_retry');
      try {
        await this.withTimeout(role, task());
      } catch (retryErr) {
        this.logger.warn(
          `[${ctx.jobId}] ${role} failed after retry — continuing degraded: ${String(retryErr)}`,
        );
        ctx.degradation.append('optional_agent_skipped');
      }
    }
  }

  private withTimeout(role: AgentRole, task: Promise<void>): Promise<void> {
    const ms = AGENT_TIMEOUTS[role];
    return Promise.race([
      task,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${role} agent timed out after ${ms / 1000}s`)), ms),
      ),
    ]);
  }
}
