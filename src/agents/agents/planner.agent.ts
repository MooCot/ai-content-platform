import { Injectable, Logger } from '@nestjs/common';
import { LLMRouterService } from '../../llm/llm-router.service';
import { AgentContext } from '../context/agent-context';
import { AgentRole, LLMProvider, Tone } from '../../common/types/domain.types';
import { PlannerOutputContractV1 } from '../../contracts';

// Canonical schema lives in contracts/v1/agents/planner.contract.ts
const PlannerOutputSchema = PlannerOutputContractV1;

@Injectable()
export class PlannerAgent {
  private readonly logger = new Logger(PlannerAgent.name);

  constructor(private readonly llmRouter: LLMRouterService) {}

  async run(ctx: AgentContext): Promise<void> {
    ctx.checkCancelled(AgentRole.PLANNER);
    const startedAt = Date.now();

    this.logger.log(`[${ctx.jobId}] PlannerAgent starting`);

    const result = await this.llmRouter.completeStructured(
      {
        systemPrompt: ctx.brandConfig.systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Plan content for the following:
Topic: ${ctx.topic}
Content Type: ${ctx.contentType}
Brand Tone: ${ctx.brandConfig.defaultTone}
Max Length: ${ctx.brandConfig.maxContentLength} words

Return a structured plan with:
- outline: ordered list of section headings/points to cover
- searchQueries: specific queries to search the knowledge base for relevant context
- targetTone: the tone to write in (${Object.values(Tone).join('|')})
- wordCountTarget: target word count
- keyMessages: 3-5 core messages the content must convey

Return only valid JSON.`,
          },
        ],
      },
      PlannerOutputSchema,
      { preferredProvider: LLMProvider.CLAUDE },
    );

    ctx.outline = result.outline;
    ctx.searchQueries = result.searchQueries;
    ctx.targetTone = result.targetTone;

    const durationMs = Date.now() - startedAt;
    this.logger.log(`[${ctx.jobId}] PlannerAgent done in ${durationMs}ms`);

    ctx.recordStep({
      agent: AgentRole.PLANNER,
      input: { topic: ctx.topic, contentType: ctx.contentType },
      output: result,
      modelUsed: LLMProvider.CLAUDE,
      durationMs,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  }
}
