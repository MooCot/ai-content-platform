import { Injectable, Logger } from '@nestjs/common';
import { LLMRouterService } from '../../llm/llm-router.service';

@Injectable()
export class RelevanceEvaluator {
  private readonly logger = new Logger(RelevanceEvaluator.name);

  constructor(private readonly llmRouter: LLMRouterService) {}

  /**
   * Scores how well `content` addresses `topic` using embedding cosine similarity.
   * Returns a value in [0, 1].
   */
  async score(topic: string, content: string): Promise<number> {
    try {
      const [topicVec, contentVec] = await this.llmRouter.embed([topic, content]);
      return this.cosineSimilarity(topicVec, contentVec);
    } catch (err) {
      this.logger.warn(`Relevance scoring failed: ${String(err)}`);
      return 0.5; // neutral fallback
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0,
      magA = 0,
      magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom > 0 ? Math.max(0, Math.min(1, dot / denom)) : 0;
  }
}
