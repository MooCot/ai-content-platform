import { z } from 'zod';
import { AgentRole, JobStatus } from '../../../common/types/domain.types';
import { ContentResultContractV1 } from '../queue/job-state.contract';

export const CONTRACT_NAME = 'SSEEventV1';

/**
 * Discriminated union of all valid SSE event shapes.
 *
 * Design invariants:
 *   - Every event carries `jobId` for stream correlation.
 *   - `type` is the discriminant — consumers switch on it.
 *   - Invalid events are rejected before reaching the SSE wire.
 *   - The `error` variant accepts any record so both internal
 *     stream errors ({ message }) and job failures ({ jobId, error })
 *     remain valid.
 */
export const SSEEventContractV1 = z.discriminatedUnion('type', [
  // ── Streaming token from LLM ────────────────────────────────────────────────
  z.object({
    type: z.literal('token'),
    data: z.object({
      delta: z.string(),
    }),
    jobId: z.string().min(1),
  }),

  // ── Agent pipeline step started ─────────────────────────────────────────────
  z.object({
    type: z.literal('agent_start'),
    data: z.object({
      agent: z.nativeEnum(AgentRole),
    }),
    jobId: z.string().min(1),
  }),

  // ── Agent pipeline step completed ───────────────────────────────────────────
  z.object({
    type: z.literal('agent_done'),
    data: z.object({
      agent: z.nativeEnum(AgentRole),
      durationMs: z.number().min(0).optional(),
    }),
    jobId: z.string().min(1),
  }),

  // ── Full job completed with content result ──────────────────────────────────
  z.object({
    type: z.literal('job_done'),
    data: z.object({
      jobId: z.string().min(1),
      status: z.nativeEnum(JobStatus),
      result: ContentResultContractV1,
    }),
    jobId: z.string().min(1),
  }),

  // ── Error — accepts both internal ({ message }) and job ({ jobId, error }) ──
  z.object({
    type: z.literal('error'),
    data: z.record(z.unknown()).refine((d) => 'message' in d || 'error' in d, {
      message: 'error event data must contain "message" or "error" field',
    }),
    jobId: z.string().min(1),
  }),

  // ── Keepalive ───────────────────────────────────────────────────────────────
  z.object({
    type: z.literal('heartbeat'),
    data: z.object({}).passthrough(),
    jobId: z.string().min(1),
  }),
]);

export type SSEEvent = z.infer<typeof SSEEventContractV1>;
export type SSEEventType = SSEEvent['type'];
