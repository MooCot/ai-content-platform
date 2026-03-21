import { z } from 'zod';
import { ContentType } from '../../../common/types/domain.types';

export const CONTRACT_NAME = 'EvaluationResultV1';

// ── Dimension sub-schemas ─────────────────────────────────────────────────────

const RelevanceDimensionV1 = z.object({
  score: z.number().min(0).max(1),
});

const ToneDimensionV1 = z.object({
  score: z.number().min(0).max(1),
  detected: z.string().min(1),
  target: z.string().min(1),
});

const FactualityDimensionV1 = z.object({
  score: z.number().min(0).max(1),
  supportedClaims: z.number().int().min(0),
  totalClaims: z.number().int().min(0),
});

const ReadabilityDimensionV1 = z.object({
  score: z.number().min(0).max(1),
});

const EvaluationDimensionsContractV1 = z.object({
  relevance: RelevanceDimensionV1,
  tone: ToneDimensionV1,
  factuality: FactualityDimensionV1,
  readability: ReadabilityDimensionV1,
});

// ── Root evaluation result ────────────────────────────────────────────────────

/**
 * Contract for evaluation records persisted to Postgres and used for
 * A/B model comparison. All scores are normalised to [0, 1].
 *
 * κ-invariant: compositeScore must be derivable from individual scores.
 * Enforced at contract boundary — prevents stale/mismatched aggregates
 * from being persisted.
 *
 * Version field enables regression tracking: evaluation records carry
 * the prompt version so score comparisons remain apples-to-apples.
 */
export const EvaluationResultContractV1 = z.object({
  _contractVersion: z.literal('v1').default('v1'),
  jobId: z.string().min(1),
  brandId: z.string().min(1),
  contentType: z.nativeEnum(ContentType),
  modelId: z.string().min(1),

  /** Semver — bump when prompts change to avoid cross-version comparisons. */
  promptVersion: z.string().regex(/^\d+\.\d+\.\d+$/, 'promptVersion must be semver x.y.z'),

  // Individual dimension scores (all normalised 0–1)
  relevanceScore: z.number().min(0).max(1),
  toneScore: z.number().min(0).max(1),
  factualityScore: z.number().min(0).max(1),
  readabilityScore: z.number().min(0).max(1),

  /** Weighted composite across all dimensions. */
  compositeScore: z.number().min(0).max(1),

  dimensions: EvaluationDimensionsContractV1,
});

export type EvaluationResult = z.infer<typeof EvaluationResultContractV1>;
