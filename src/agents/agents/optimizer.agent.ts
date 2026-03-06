import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LLMRouterService } from '../../llm/llm-router.service';
import { ToolsRegistry } from '../../tools/tools.registry';
import { AgentContext } from '../context/agent-context';
import { AgentRole, LLMProvider } from '../../common/types/domain.types';
import { SeoKeywordOutput } from '../../tools/tools/seo-keyword.tool';

const OptimizedOutputSchema = z.object({
  optimizedContent: z.string(),
  changesApplied: z.array(z.string()),
});

@Injectable()
export class OptimizerAgent {
  private readonly logger = new Logger(OptimizerAgent.name);

  constructor(
    private readonly llmRouter: LLMRouterService,
    private readonly tools: ToolsRegistry,
  ) {}

  async run(ctx: AgentContext): Promise<void> {
    ctx.checkCancelled(AgentRole.OPTIMIZER);
    const startedAt = Date.now();

    this.logger.log(`[${ctx.jobId}] OptimizerAgent starting`);

    // ── 1. Extract SEO keywords ───────────────────────────────────────────────
    const seoResult = await this.tools.get('seo_keyword_extractor').execute({
      content: ctx.draftContent,
      topic: ctx.topic,
    });

    let seoData: SeoKeywordOutput | null = null;
    if (seoResult.success) {
      seoData = seoResult.result as SeoKeywordOutput;
      ctx.seoKeywords = [
        seoData.primaryKeyword,
        ...seoData.secondaryKeywords,
        ...seoData.longTailKeywords,
      ];
    }

    // ── 2. Analyze tone ───────────────────────────────────────────────────────
    const toneResult = await this.tools.get('tone_analyzer').execute({
      content: ctx.draftContent,
      targetTone: ctx.targetTone,
    });

    // ── 3. Optimize content with LLM ─────────────────────────────────────────
    const toneGuidance = toneResult.success
      ? `The content's detected tone is "${(toneResult.result as { detected: string }).detected}". Adjust to match the target tone: ${ctx.targetTone}.`
      : `Ensure tone matches: ${ctx.targetTone}.`;

    const seoGuidance = seoData
      ? `Naturally integrate these keywords: ${seoData.primaryKeyword}, ${seoData.secondaryKeywords.slice(0, 3).join(', ')}.`
      : '';

    const result = await this.llmRouter.completeStructured(
      {
        systemPrompt: ctx.brandConfig.systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Optimize this content for tone, SEO, and engagement.

${toneGuidance}
${seoGuidance}

Original content:
${ctx.draftContent}

Return JSON with:
- optimizedContent: the improved full content
- changesApplied: list of specific changes made`,
          },
        ],
      },
      OptimizedOutputSchema,
      { preferredProvider: LLMProvider.OPENAI },
    );

    ctx.optimizedContent = result.optimizedContent;

    const durationMs = Date.now() - startedAt;
    this.logger.log(`[${ctx.jobId}] OptimizerAgent done`);

    ctx.recordStep({
      agent: AgentRole.OPTIMIZER,
      input: { contentLength: ctx.draftContent.length, targetTone: ctx.targetTone },
      output: {
        changesApplied: result.changesApplied,
        seoKeywords: ctx.seoKeywords.slice(0, 5),
      },
      modelUsed: LLMProvider.OPENAI,
      durationMs,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  }
}
