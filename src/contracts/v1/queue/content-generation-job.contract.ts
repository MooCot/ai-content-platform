import { z } from 'zod';
import { ContentType } from '../../../common/types/domain.types';

export const CONTRACT_NAME = 'ContentGenerationJobV1';

/**
 * Contract for the BullMQ job payload.
 *
 * Validated before enqueue (QueueService) and before execution
 * (ContentPipelineProcessor). jobId doubles as the BullMQ jobId,
 * making enqueue idempotent at the Redis level.
 *
 * Version field enables parallel schema evolution: v1 jobs are
 * processed by v1 logic; future v2 shape can coexist in the same queue.
 */
export const ContentGenerationJobContractV1 = z.object({
  /** Contract schema version — consumers must assert this before processing. */
  _contractVersion: z.literal('v1').default('v1'),

  /** Postgres ContentJobEntity.id — also used as BullMQ jobId for idempotency. */
  jobId: z.string().min(1),

  /** Owning brand — used for RAG collection scoping and brand config lookup. */
  brandId: z.string().min(1),

  dto: z.object({
    topic: z.string().min(1).max(300),
    contentType: z.nativeEnum(ContentType),
  }),

  /** Propagated X-Correlation-ID for distributed tracing. */
  correlationId: z.string().min(1),

  /** Idempotency key — identical to jobId but semantically distinct role. */
  idempotencyKey: z.string().min(1),

  /** ISO-8601 timestamp set at enqueue time. */
  enqueuedAt: z.string().datetime(),
});

export type ContentGenerationJob = z.infer<typeof ContentGenerationJobContractV1>;
