import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LLMRouterService } from '../../llm/llm-router.service';
import { ToolsRegistry } from '../../tools/tools.registry';
import { AgentContext } from '../context/agent-context';
import { AgentRole, LLMProvider } from '../../common/types/domain.types';

const QAOutputSchema = z.object({
  finalContent: z.string(),
  approved: z.boolean(),
  issues: z.array(z.string()),
  corrections: z.array(z.string()),
  qualityScore: z.number().min(0).max(100),
});

@Injectable()
export class QAAgent {
  private readonly logger = new Logger(QAAgent.name);

  constructor(
    private readonly llmRouter: LLMRouterService,
    private readonly tools: ToolsRegistry,
  ) {}

  async run(ctx: AgentContext): Promise<void> {
    ctx.checkCancelled(AgentRole.QA);
    const startedAt = Date.now();

    this.logger.log(`[${ctx.jobId}] QAAgent starting`);

    const content = ctx.optimizedContent || ctx.draftContent;

    // ── 1. Readability check ──────────────────────────────────────────────────
    const readabilityResult = await this.tools.get('readability_checker').execute({ content });

    if (readabilityResult.success) {
      const readability = readabilityResult.result as { fleschReadingEase: number };
      ctx.readabilityScore = readability.fleschReadingEase;
    }

    // ── 2. QA review with LLM ─────────────────────────────────────────────────
    const readabilityContext = readabilityResult.success
      ? `Readability score: ${ctx.readabilityScore}/100 (Flesch Reading Ease).`
      : '';

    const result = await this.llmRouter.completeStructured(
      {
        systemPrompt: `You are a senior editor. Review content for quality, accuracy, coherence, and brand alignment.`,
        messages: [
          {
            role: 'user',
            content: `Review this content for quality. Apply corrections if needed.

Topic: ${ctx.topic}
Content Type: ${ctx.contentType}
Target Tone: ${ctx.targetTone}
${readabilityContext}
Citations available: ${ctx.citations.join(', ') || 'none'}

Content to review:
${content}

Return JSON with:
- finalContent: corrected content (or unchanged if good)
- approved: true if ready to publish
- issues: list of issues found (empty if none)
- corrections: list of corrections made
- qualityScore: 0-100 quality score`,
          },
        ],
      },
      QAOutputSchema,
      {
        preferredProvider: LLMProvider.CLAUDE,
        onFallback: () => ctx.degradation.append('llm_fallback'),
      },
    );

    ctx.finalContent = result.finalContent;
    ctx.approved = result.approved;

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[${ctx.jobId}] QAAgent done: approved=${result.approved}, score=${result.qualityScore}`,
    );

    ctx.recordStep({
      agent: AgentRole.QA,
      input: { contentLength: content.length, readabilityScore: ctx.readabilityScore },
      output: {
        approved: result.approved,
        qualityScore: result.qualityScore,
        issueCount: result.issues.length,
        corrections: result.corrections,
      },
      modelUsed: LLMProvider.CLAUDE,
      durationMs,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  }
}
