import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompositeScoreInput } from '../../common/types/domain.types';
import { AppConfig } from '../../common/config/configuration';

@Injectable()
export class CompositeEvaluator {
  private readonly weights: Record<keyof CompositeScoreInput, number>;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.weights = this.config.get('evaluation.compositeWeights', { infer: true });
  }

  /**
   * Weighted average of the four dimension scores.
   * All inputs and output are in [0, 1].
   */
  score(input: CompositeScoreInput): number {
    const { relevance, tone, factuality, readability } = this.weights;
    const raw =
      input.relevance * relevance +
      input.tone * tone +
      input.factuality * factuality +
      input.readability * readability;

    return Math.max(0, Math.min(1, parseFloat(raw.toFixed(4))));
  }
}
