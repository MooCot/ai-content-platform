import { z } from 'zod';

// ── Input ─────────────────────────────────────────────────────────────────────

export const OptimizerInputContractV1 = z.object({
  jobId: z.string().min(1),
  draftContent: z.string().min(1),
  citations: z.array(z.string()),
});

export type OptimizerInput = z.infer<typeof OptimizerInputContractV1>;

// ── Output ────────────────────────────────────────────────────────────────────

export const OptimizerOutputContractV1 = z.object({
  // Top 5 SEO keywords extracted from the optimized content
  seoKeywords: z.array(z.string()).max(5),
  changesApplied: z.array(z.string()),
});

export type OptimizerOutput = z.infer<typeof OptimizerOutputContractV1>;
