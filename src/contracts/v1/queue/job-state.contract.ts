import { z } from 'zod';
import { ContentType, JobStatus, Tone } from '../../../common/types/domain.types';

export const CONTRACT_NAME = 'JobStateV1';

// ── Tone analysis sub-schema ──────────────────────────────────────────────────

const ToneAnalysisContractV1 = z.object({
  detected: z.nativeEnum(Tone),
  confidence: z.number().min(0).max(1),
  scores: z.record(z.number()),
});

// ── Content result sub-schema (mirrors domain.types.ContentResult) ────────────

export const ContentResultContractV1 = z.object({
  raw: z.string(),
  optimized: z.string(),
  seoKeywords: z.array(z.string()),
  readabilityScore: z.number().min(0).max(100),
  toneAnalysis: ToneAnalysisContractV1,
  wordCount: z.number().int().min(0),
  citations: z.array(z.string()),
});

export type ContentResult = z.infer<typeof ContentResultContractV1>;

// ── Job state contract ────────────────────────────────────────────────────────

/**
 * Represents a job state transition payload (used for DB updates and SSE events).
 * Guards against invalid transitions reaching the persistence layer.
 */
export const JobStateContractV1 = z.object({
  _contractVersion: z.literal('v1').default('v1'),
  jobId: z.string().min(1),
  brandId: z.string().min(1),
  contentType: z.nativeEnum(ContentType),
  status: z.nativeEnum(JobStatus),
  result: ContentResultContractV1.nullable().optional(),
  errorMessage: z.string().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type JobState = z.infer<typeof JobStateContractV1>;
