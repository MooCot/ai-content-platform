import { z } from 'zod';
import { Tone } from '../../../common/types/domain.types';

// ── Input ─────────────────────────────────────────────────────────────────────

export const GeneratorInputContractV1 = z.object({
  jobId: z.string().min(1),
  brandId: z.string().min(1),
  outline: z.array(z.string()).min(1),
  targetTone: z.nativeEnum(Tone),
  ragContextCount: z.number().int().min(0),
  wordCountTarget: z.number().int().min(100).optional(),
});

export type GeneratorInput = z.infer<typeof GeneratorInputContractV1>;

// ── Output ────────────────────────────────────────────────────────────────────

export const GeneratorOutputContractV1 = z.object({
  // Draft content is streamed via SSE; output records only metadata
  wordCount: z.number().int().min(1),
  streamedTokens: z.number().int().min(0),
});

export type GeneratorOutput = z.infer<typeof GeneratorOutputContractV1>;
