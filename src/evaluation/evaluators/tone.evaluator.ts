import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LLMRouterService } from '../../llm/llm-router.service';
import { Tone } from '../../common/types/domain.types';

const ToneJudgementSchema = z.object({
  score: z.number().min(0).max(1),
  detected: z.string(),
  reasoning: z.string(),
});

@Injectable()
export class ToneEvaluator {
  private readonly logger = new Logger(ToneEvaluator.name);

  constructor(private readonly llmRouter: LLMRouterService) {}

  /**
   * LLM-judge: how well does the content match the target tone?
   * Returns score ∈ [0, 1] and the detected tone label.
   */
  async score(targetTone: Tone, content: string): Promise<{ score: number; detected: string }> {
    const excerpt = content.slice(0, 1500); // keep prompt cost bounded

    try {
      const result = await this.llmRouter.completeStructured(
        {
          systemPrompt: 'You are an expert content tone analyst. Be concise and precise.',
          messages: [
            {
              role: 'user',
              content: `Evaluate whether the following content matches the target tone.

Target tone: ${targetTone}
Available tones: ${Object.values(Tone).join(', ')}

Content (excerpt):
"""
${excerpt}
"""

Return JSON:
- score: 0.0–1.0 (1.0 = perfect match, 0.0 = complete mismatch)
- detected: the actual tone you observe in the content (one of the available tones)
- reasoning: one sentence explanation`,
            },
          ],
        },
        ToneJudgementSchema,
      );

      return { score: result.score, detected: result.detected };
    } catch (err) {
      this.logger.warn(`Tone scoring failed: ${String(err)}`);
      return { score: 0.5, detected: 'UNKNOWN' };
    }
  }
}
