import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LLMRouterService } from '../../llm/llm-router.service';
import { SearchResult } from '../../common/types/domain.types';

const FactualityJudgementSchema = z.object({
  score: z.number().min(0).max(1),
  supportedClaims: z.number().int().min(0),
  totalClaims: z.number().int().min(0),
  unsupportedClaims: z.array(z.string()),
});

@Injectable()
export class FactualityEvaluator {
  private readonly logger = new Logger(FactualityEvaluator.name);

  constructor(private readonly llmRouter: LLMRouterService) {}

  /**
   * LLM-judge: what fraction of factual claims in `content` are supported
   * by the RAG context chunks?
   *
   * When ragContext is empty (RAG disabled), returns a neutral 0.5 score
   * since factuality cannot be verified without a reference corpus.
   */
  async score(
    content: string,
    ragContext: SearchResult[],
  ): Promise<{ score: number; supportedClaims: number; totalClaims: number }> {
    if (ragContext.length === 0) {
      return { score: 0.5, supportedClaims: 0, totalClaims: 0 };
    }

    // Build compact reference corpus (top 5 chunks by score)
    const sources = ragContext
      .slice(0, 5)
      .map((r, i) => `[${i + 1}] ${r.content.slice(0, 400)}`)
      .join('\n\n');

    const excerpt = content.slice(0, 1500);

    try {
      const result = await this.llmRouter.completeStructured(
        {
          systemPrompt:
            'You are a rigorous fact-checker. Evaluate factual accuracy using only the provided sources.',
          messages: [
            {
              role: 'user',
              content: `Reference sources:
${sources}

Content to fact-check (excerpt):
"""
${excerpt}
"""

Identify factual claims in the content. For each claim, determine if it is supported by the sources above.

Return JSON:
- score: 0.0–1.0 (supportedClaims / totalClaims, or 1.0 if no factual claims)
- supportedClaims: number of claims found in the sources
- totalClaims: total factual claims identified
- unsupportedClaims: list of claims NOT supported (max 5)`,
            },
          ],
        },
        FactualityJudgementSchema,
      );

      return {
        score: result.score,
        supportedClaims: result.supportedClaims,
        totalClaims: result.totalClaims,
      };
    } catch (err) {
      this.logger.warn(`Factuality scoring failed: ${String(err)}`);
      return { score: 0.5, supportedClaims: 0, totalClaims: 0 };
    }
  }
}
