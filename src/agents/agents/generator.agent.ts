import { Injectable, Logger } from '@nestjs/common';
import { LLMRouterService } from '../../llm/llm-router.service';
import { StreamingService } from '../../streaming/streaming.service';
import { AgentContext } from '../context/agent-context';
import { AgentRole, LLMProvider, TokenUsage } from '../../common/types/domain.types';

@Injectable()
export class GeneratorAgent {
  private readonly logger = new Logger(GeneratorAgent.name);

  constructor(
    private readonly llmRouter: LLMRouterService,
    private readonly streaming: StreamingService,
  ) {}

  async run(ctx: AgentContext): Promise<void> {
    ctx.checkCancelled(AgentRole.GENERATOR);
    const startedAt = Date.now();

    this.logger.log(`[${ctx.jobId}] GeneratorAgent starting`);

    const ragSnippet = ctx.ragContext.length
      ? `\n\n## Knowledge Base Context\n${ctx.ragContext
          .slice(0, 8)
          .map((r, i) => `[${i + 1}] ${r.content}`)
          .join('\n\n')}`
      : '';

    const outlineSection = ctx.outline.length
      ? `\n\n## Content Outline\n${ctx.outline.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
      : '';

    const prompt = `Write a complete ${ctx.contentType} about "${ctx.topic}".

Tone: ${ctx.targetTone}
${outlineSection}${ragSnippet}

Write the full content now. Do not add meta-commentary. Write directly.`;

    // Stream tokens to SSE
    const streamObservable = this.llmRouter.stream(
      {
        systemPrompt: ctx.brandConfig.systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: ctx.brandConfig.maxContentLength * 2,
      },
      {
        preferredProvider: LLMProvider.CLAUDE,
        onFallback: () => ctx.degradation.append('llm_fallback'),
      },
    );

    let fullContent = '';
    let finalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    await new Promise<void>((resolve, reject) => {
      streamObservable.subscribe({
        next: (chunk) => {
          if (ctx.isCancelled) return;

          if (chunk.delta) {
            fullContent += chunk.delta;
            this.streaming.emit(ctx.jobId, {
              type: 'token',
              data: { delta: chunk.delta },
              jobId: ctx.jobId,
            });
          }

          if (chunk.done && chunk.usage) {
            finalUsage = chunk.usage;
          }
        },
        error: reject,
        complete: resolve,
      });
    });

    ctx.draftContent = fullContent;

    const durationMs = Date.now() - startedAt;
    this.logger.log(`[${ctx.jobId}] GeneratorAgent done: ${fullContent.length} chars`);

    ctx.recordStep({
      agent: AgentRole.GENERATOR,
      input: { topic: ctx.topic, ragChunks: ctx.ragContext.length },
      output: { wordCount: fullContent.split(/\s+/).length },
      modelUsed: LLMProvider.CLAUDE,
      durationMs,
      tokens: finalUsage,
    });
  }
}
