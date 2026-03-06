import { Injectable, Logger } from '@nestjs/common';
import { AgentContext } from '../context/agent-context';
import { PlannerAgent } from '../agents/planner.agent';
import { ResearcherAgent } from '../agents/researcher.agent';
import { GeneratorAgent } from '../agents/generator.agent';
import { OptimizerAgent } from '../agents/optimizer.agent';
import { QAAgent } from '../agents/qa.agent';
import { StreamingService } from '../../streaming/streaming.service';
import { AgentRole, ContentResult } from '../../common/types/domain.types';

@Injectable()
export class AgentOrchestratorService {
  private readonly logger = new Logger(AgentOrchestratorService.name);

  // Pipeline order is strictly enforced here
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
  ) {}

  async run(ctx: AgentContext): Promise<ContentResult> {
    this.logger.log(`[${ctx.jobId}] Pipeline starting: ${this.pipeline.join(' → ')}`);

    const agents: Record<AgentRole, () => Promise<void>> = {
      [AgentRole.PLANNER]: () => this.planner.run(ctx),
      [AgentRole.RESEARCHER]: () => this.researcher.run(ctx),
      [AgentRole.GENERATOR]: () => this.generator.run(ctx),
      [AgentRole.OPTIMIZER]: () => this.optimizer.run(ctx),
      [AgentRole.QA]: () => this.qa.run(ctx),
    };

    for (const role of this.pipeline) {
      if (ctx.isCancelled) {
        this.logger.warn(`[${ctx.jobId}] Pipeline cancelled at ${role}`);
        break;
      }

      // Emit agent_start event
      this.streaming.emit(ctx.jobId, {
        type: 'agent_start',
        data: { agent: role },
        jobId: ctx.jobId,
      });

      await agents[role]();

      // Emit agent_done event with the step output
      const lastStep = ctx.steps[ctx.steps.length - 1];
      this.streaming.emit(ctx.jobId, {
        type: 'agent_done',
        data: { agent: role, durationMs: lastStep?.durationMs },
        jobId: ctx.jobId,
      });
    }

    const result: ContentResult = {
      raw: ctx.draftContent,
      optimized: ctx.optimizedContent,
      seoKeywords: ctx.seoKeywords,
      readabilityScore: ctx.readabilityScore,
      toneAnalysis: {
        detected: ctx.targetTone,
        confidence: 0.9,
        scores: {} as ContentResult['toneAnalysis']['scores'],
      },
      wordCount: ctx.finalContent.split(/\s+/).filter(Boolean).length,
      citations: ctx.citations,
    };

    this.logger.log(`[${ctx.jobId}] Pipeline complete`);
    return result;
  }
}
