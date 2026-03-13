import { GenerateContentDto } from '../content/dto/content.dto';

export const CONTENT_PIPELINE_QUEUE = 'content-pipeline';

/** Retry config: 3 attempts, exponential backoff starting at 2 s. */
export const PIPELINE_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 }, // keep failed jobs in Redis for inspection
} as const;

export interface ContentPipelineJobData {
  jobId: string;
  brandId: string;
  dto: GenerateContentDto;
  correlationId: string;
}
