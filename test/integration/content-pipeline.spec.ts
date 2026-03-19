/**
 * Integration test: full content pipeline from ContentService → BullMQ → ContentPipelineProcessor.
 *
 * All external dependencies (LLM providers, Qdrant, Redis/BullMQ) are mocked at the
 * module boundary, but all NestJS module wiring is real.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ContentService } from '../../src/content/content.service';
import { ContentPipelineProcessor } from '../../src/queue/processors/content-pipeline.processor';
import { AgentOrchestratorService } from '../../src/agents/orchestrator/agent-orchestrator.service';
import { BrandsService } from '../../src/brands/brands.service';
import { StreamingService } from '../../src/streaming/streaming.service';
import { EvaluationService } from '../../src/evaluation/evaluation.service';
import { MetricsService } from '../../src/observability/metrics.service';
import { QueueService } from '../../src/queue/queue.service';
import { ContentJobEntity } from '../../src/content/entities/content-job.entity';
import { configuration } from '../../src/common/config/configuration';
import { ContentType, JobStatus } from '../../src/common/types/domain.types';
import { createRepositoryMock } from '../utils/repository.mock';
import { createBrandFixture } from '../fixtures/brand.fixture';
import { createContentJobFixture } from '../fixtures/content-job.fixture';
import { createAgentContextFixture } from '../fixtures/agent-context.fixture';
import { MockQueueService } from '../mocks/queue.mock';
import { Job } from 'bullmq';

function buildResult() {
  return {
    raw: 'draft content',
    optimized: 'optimized content',
    seoKeywords: ['keyword'],
    readabilityScore: 78,
    toneAnalysis: { detected: 'TECHNICAL' as const, confidence: 0.9, scores: {} as never },
    wordCount: 200,
    citations: ['source.pdf'],
  };
}

function buildBullJob(overrides = {}): Partial<Job> {
  return {
    data: {
      jobId: 'job-integration-1',
      brandId: 'brand-test-uuid',
      dto: { topic: 'Integration test topic', contentType: ContentType.BLOG },
      correlationId: 'corr-integration-1',
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    timestamp: Date.now() - 300,
    ...overrides,
  };
}

describe('ContentPipeline Integration', () => {
  let contentService: ContentService;
  let processor: ContentPipelineProcessor;
  let jobRepoMock: ReturnType<typeof createRepositoryMock<ContentJobEntity>>;
  let orchestratorMock: jest.Mocked<AgentOrchestratorService>;
  let streamingMock: jest.Mocked<StreamingService>;
  let evaluationMock: jest.Mocked<EvaluationService>;
  let metricsMock: jest.Mocked<MetricsService>;
  let brandsServiceMock: jest.Mocked<BrandsService>;
  let queueService: MockQueueService;

  beforeEach(async () => {
    jobRepoMock = createRepositoryMock<ContentJobEntity>();
    queueService = new MockQueueService();
    orchestratorMock = { run: jest.fn().mockResolvedValue(buildResult()) } as unknown as jest.Mocked<AgentOrchestratorService>;
    streamingMock    = { emit: jest.fn(), close: jest.fn(), isActive: jest.fn().mockReturnValue(true) } as unknown as jest.Mocked<StreamingService>;
    evaluationMock   = { evaluate: jest.fn().mockResolvedValue(undefined) } as unknown as jest.Mocked<EvaluationService>;
    metricsMock      = { recordPipelineLatency: jest.fn(), recordQueueWaitTime: jest.fn(), setQueueDepth: jest.fn() } as unknown as jest.Mocked<MetricsService>;

    const brand = createBrandFixture();
    brandsServiceMock = { findById: jest.fn().mockResolvedValue(brand) } as unknown as jest.Mocked<BrandsService>;

    const jobEntity = createContentJobFixture({ status: JobStatus.QUEUED });
    jobRepoMock.create.mockReturnValue(jobEntity as ContentJobEntity);
    jobRepoMock.save.mockResolvedValue(jobEntity as ContentJobEntity);
    jobRepoMock.update.mockResolvedValue({ affected: 1 } as never);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        ContentPipelineProcessor,
        { provide: getRepositoryToken(ContentJobEntity), useValue: jobRepoMock },
        { provide: BrandsService,            useValue: brandsServiceMock  },
        { provide: QueueService,             useValue: queueService        },
        { provide: AgentOrchestratorService, useValue: orchestratorMock   },
        { provide: StreamingService,         useValue: streamingMock       },
        { provide: EvaluationService,        useValue: evaluationMock      },
        { provide: MetricsService,           useValue: metricsMock         },
      ],
    }).compile();

    contentService = module.get(ContentService);
    processor      = module.get(ContentPipelineProcessor);
  });

  // ── Full lifecycle: createJob → process ────────────────────────────────────

  it('creates a QUEUED job and processes it to DONE status', async () => {
    // Step 1: ContentService creates and enqueues the job
    const dto = { topic: 'Integration test topic', contentType: ContentType.BLOG };
    const job = await contentService.createJob('brand-test-uuid', dto, 'corr-1');

    expect(job.status).toBe(JobStatus.QUEUED);
    expect(queueService.getEnqueuedJobs()).toHaveLength(1);
    expect(queueService.getEnqueuedJobs()[0].jobId).toBe(job.id);

    // Step 2: Simulate the BullMQ worker picking up the job
    await processor.process(buildBullJob() as Job);

    // Job updated to RUNNING, then DONE
    const updateStatuses = jobRepoMock.update.mock.calls.map(
      ([, p]) => (p as { status: string }).status,
    );
    expect(updateStatuses).toContain(JobStatus.RUNNING);
    expect(updateStatuses).toContain(JobStatus.DONE);
  });

  it('emits job_done SSE event after pipeline completion', async () => {
    await processor.process(buildBullJob() as Job);
    expect(streamingMock.emit).toHaveBeenCalledWith(
      'job-integration-1',
      expect.objectContaining({ type: 'job_done' }),
    );
  });

  it('triggers evaluation after pipeline — fire-and-forget', async () => {
    await processor.process(buildBullJob() as Job);
    expect(evaluationMock.evaluate).toHaveBeenCalled();
  });

  // ── Retry lifecycle ────────────────────────────────────────────────────────

  it('transitions to RETRYING on non-final failure, then FAILED on final attempt', async () => {
    // First failure (attemptsMade=1, maxAttempts=3) → RETRYING
    const retryJob = buildBullJob({ attemptsMade: 1 }) as Job;
    processor.onFailed(retryJob, new Error('transient'));
    expect(jobRepoMock.update).toHaveBeenCalledWith('job-integration-1', { status: JobStatus.RETRYING });

    jobRepoMock.update.mockClear();

    // Final failure (attemptsMade=3) → FAILED + SSE error
    const finalJob = buildBullJob({ attemptsMade: 3 }) as Job;
    processor.onFailed(finalJob, new Error('permanent'));
    const failedCall = jobRepoMock.update.mock.calls.find(
      ([, p]) => (p as { status: string }).status === JobStatus.FAILED,
    );
    expect(failedCall).toBeDefined();
    expect(streamingMock.emit).toHaveBeenCalledWith(
      'job-integration-1',
      expect.objectContaining({ type: 'error' }),
    );
  });

  // ── Brand isolation (κ-invariant) ─────────────────────────────────────────

  it('looks up brand by ID from the job data, not a hardcoded value', async () => {
    await processor.process(buildBullJob() as Job);
    expect(brandsServiceMock.findById).toHaveBeenCalledWith('brand-test-uuid');
  });

  // ── Zombie-job cleanup on startup (κ-invariant) ────────────────────────────

  it('marks RUNNING jobs as FAILED on module init', async () => {
    jobRepoMock.update.mockResolvedValue({ affected: 2 } as never);
    await contentService.onModuleInit();
    expect(jobRepoMock.update).toHaveBeenCalledWith(
      { status: JobStatus.RUNNING },
      expect.objectContaining({ status: JobStatus.FAILED }),
    );
  });
});
