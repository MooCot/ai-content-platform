import {
  AgentRole,
  AgentStep,
  BrandId,
  ContentType,
  JobId,
  SearchResult,
  Tone,
} from '../../common/types/domain.types';
import { BrandConfig } from '../../brands/entities/brand.entity';

/** Shared mutable context threaded through the agent pipeline. */
export class AgentContext {
  readonly jobId: JobId;
  readonly brandId: BrandId;
  readonly brandConfig: BrandConfig;
  readonly topic: string;
  readonly contentType: ContentType;
  readonly steps: AgentStep[] = [];

  // Populated by PlannerAgent
  outline: string[] = [];
  searchQueries: string[] = [];
  targetTone: Tone = Tone.FORMAL;

  // Populated by ResearchAgent
  ragContext: SearchResult[] = [];
  citations: string[] = [];

  // Populated by GeneratorAgent
  draftContent = '';

  // Populated by OptimizerAgent
  optimizedContent = '';
  seoKeywords: string[] = [];

  // Populated by QAAgent
  finalContent = '';
  readabilityScore = 0;
  approved = false;

  isCancelled = false;

  /** X-Correlation-ID propagated from the original HTTP request. */
  readonly correlationId: string;

  constructor(opts: {
    jobId: JobId;
    brandId: BrandId;
    brandConfig: BrandConfig;
    topic: string;
    contentType: ContentType;
    correlationId?: string;
  }) {
    this.jobId = opts.jobId;
    this.brandId = opts.brandId;
    this.brandConfig = opts.brandConfig;
    this.topic = opts.topic;
    this.contentType = opts.contentType;
    this.correlationId = opts.correlationId ?? '';
  }

  recordStep(step: Omit<AgentStep, 'startedAt'>): void {
    this.steps.push({ ...step, startedAt: new Date() });
  }

  cancel(): void {
    this.isCancelled = true;
  }

  checkCancelled(agent: AgentRole): void {
    if (this.isCancelled) {
      throw new Error(`Pipeline cancelled before ${agent} agent`);
    }
  }
}
