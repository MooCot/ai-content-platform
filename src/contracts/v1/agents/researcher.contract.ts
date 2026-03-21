import { z } from 'zod';

// ── Input ─────────────────────────────────────────────────────────────────────

export const ResearcherInputContractV1 = z.object({
  jobId: z.string().min(1),
  brandId: z.string().min(1),
  searchQueries: z.array(z.string().min(1)).min(1),
  ragEnabled: z.boolean(),
});

export type ResearcherInput = z.infer<typeof ResearcherInputContractV1>;

// ── Output ────────────────────────────────────────────────────────────────────

export const ResearcherOutputContractV1 = z.object({
  chunkCount: z.number().int().min(0),
  citations: z.array(z.string()),
  topScores: z.array(z.number().min(0).max(1)),
});

export type ResearcherOutput = z.infer<typeof ResearcherOutputContractV1>;
