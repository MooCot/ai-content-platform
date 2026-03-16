import { EvaluationRecordEntity } from '../../src/evaluation/entities/evaluation-record.entity';
import { ContentType } from '../../src/common/types/domain.types';

export function createEvaluationRecordFixture(
  overrides: Partial<EvaluationRecordEntity> = {},
): EvaluationRecordEntity {
  return {
    id: 'eval-test-uuid',
    jobId: 'job-test-uuid',
    brandId: 'brand-test-uuid',
    contentType: ContentType.BLOG,
    modelId: 'claude-sonnet-4-6',
    promptVersion: '1.0.0',
    relevanceScore: 0.85,
    toneScore: 0.78,
    factualityScore: 0.90,
    readabilityScore: 0.72,
    compositeScore: 0.82,
    dimensions: {
      relevance: { score: 0.85 },
      tone: { score: 0.78, detected: 'TECHNICAL', target: 'TECHNICAL' },
      factuality: { score: 0.90, supportedClaims: 9, totalClaims: 10 },
      readability: { score: 0.72 },
    },
    evaluatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  } as EvaluationRecordEntity;
}

/** Returns a fixture with a composite score below the 0.70 memory indexing threshold. */
export function createLowScoreEvaluationFixture(): EvaluationRecordEntity {
  return createEvaluationRecordFixture({
    relevanceScore: 0.50,
    toneScore: 0.45,
    factualityScore: 0.55,
    readabilityScore: 0.60,
    compositeScore: 0.52,
  });
}
