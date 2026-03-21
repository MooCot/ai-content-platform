import { z } from 'zod';

// ── Input ─────────────────────────────────────────────────────────────────────

export const QAInputContractV1 = z.object({
  jobId: z.string().min(1),
  optimizedContent: z.string().min(1),
  targetTone: z.string().min(1),
});

export type QAInput = z.infer<typeof QAInputContractV1>;

// ── Output ────────────────────────────────────────────────────────────────────

export const QAOutputContractV1 = z.object({
  approved: z.boolean(),
  qualityScore: z.number().min(0).max(100),
  issueCount: z.number().int().min(0),
  corrections: z.array(z.string()),
});

export type QAOutput = z.infer<typeof QAOutputContractV1>;
