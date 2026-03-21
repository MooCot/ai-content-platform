import { z } from 'zod';
import { ContentType, LLMProvider, Tone } from '../../../common/types/domain.types';

export const CONTRACT_VERSION = 'v1' as const;

// ── Input ─────────────────────────────────────────────────────────────────────

const BrandConfigContractV1 = z.object({
  defaultTone: z.nativeEnum(Tone),
  allowedModels: z.array(z.string()),
  preferredProvider: z.nativeEnum(LLMProvider),
  ragEnabled: z.boolean(),
  systemPrompt: z.string(),
  maxContentLength: z.number().int().min(100),
});

export const PlannerInputContractV1 = z.object({
  jobId: z.string().min(1),
  brandId: z.string().min(1),
  topic: z.string().min(1).max(300),
  contentType: z.nativeEnum(ContentType),
  brandConfig: BrandConfigContractV1,
  correlationId: z.string().min(1),
});

export type PlannerInput = z.infer<typeof PlannerInputContractV1>;

// ── Output ────────────────────────────────────────────────────────────────────

export const PlannerOutputContractV1 = z.object({
  outline: z.array(z.string()).min(3).max(10),
  searchQueries: z.array(z.string()).min(2).max(8),
  targetTone: z.nativeEnum(Tone),
  wordCountTarget: z.number().int().min(200).max(5000),
  keyMessages: z.array(z.string()).min(1),
});

export type PlannerOutput = z.infer<typeof PlannerOutputContractV1>;
