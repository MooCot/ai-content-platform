/**
 * Integration test: full content pipeline from ContentService → BullMQ → ContentPipelineProcessor.
 *
 * All external dependencies (LLM providers, Qdrant, Redis/BullMQ) are mocked at the
 * module boundary, but all NestJS module wiring is real.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContentService } from '../../src/content/content.service';
import { ContentPipelineProcessor } from '../../src/queue/processors/content-pipeline.processor';
import { AgentOrchestratorService } from '../../src/agents/orchestrator/agent-orchestrator.service';
import { BrandsService } from '../../src/brands/brands.service';
import { StreamingService } from '../../src/streaming/streaming.service';
import { EvaluationService } from '../../src/evaluation/evaluation.service';
import { MetricsService } from '../../src/observability/metrics.service';
import { QueueService } from '../../src/queue/queue.service';
import { DegradationService } from '../../src/resilience/degradation.service';
import { AgentContext } from '../../src/agents/context/agent-context';
import { ContentJobEntity } from '../../src/content/entities/content-job.entity';
import { ContentType, JobStatus, Tone } from '../../src/common/types/domain.types';
import { createRepositoryMock } from '../utils/repository.mock';
import { createBrandFixture } from '../fixtures/brand.fixture';
import { createContentJobFixture } from '../fixtures/content-job.fixture';
import { MockQueueService } from '../mocks/queue.mock';
import { Job } from 'bullmq';

function buildResult() {
  return {
    raw: 'draft content',
    optimized: 'optimized content',
    seoKeywords: ['keyword'],
    readabilityScore: 78,
    toneAnalysis: { detected: Tone.TECHNICAL, confidence: 0.9, scores: {} as never },
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
    const updateStatuses = (jobRepoMock.update.mock.calls as unknown as Array<[unknown, { status: string }]>).map(
      ([, p]) => p.status,
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
    const failedCall = (jobRepoMock.update.mock.calls as unknown as Array<[unknown, { status: string }]>).find(
      ([, p]) => p.status === JobStatus.FAILED,
    );
    expect(failedCall).toBeDefined();
    expect(streamingMock.emit).toHaveBeenCalledWith(
      'job-integration-1',
      expect.objectContaining({ type: 'error' }),
    );
  });

  // ── Brand isolation (invariant) ─────────────────────────────────────────

  it('looks up brand by ID from the job data, not a hardcoded value', async () => {
    await processor.process(buildBullJob() as Job);
    expect(brandsServiceMock.findById).toHaveBeenCalledWith('brand-test-uuid');
  });

  // ── Zombie-job cleanup on startup (invariant) ────────────────────────────

  it('marks RUNNING jobs as FAILED on module init', async () => {
    jobRepoMock.update.mockResolvedValue({ affected: 2 } as never);
    await contentService.onModuleInit();
    expect(jobRepoMock.update).toHaveBeenCalledWith(
      { status: JobStatus.RUNNING },
      expect.objectContaining({ status: JobStatus.FAILED }),
    );
  });

  // ── Degradation path (queue overload) ─────────────────────────────────────

  describe('Degradation path — queue overload', () => {
    let degradedProcessor: ContentPipelineProcessor;
    let degradedMetrics: jest.Mocked<MetricsService>;
    let degradedJobRepo: ReturnType<typeof createRepositoryMock<ContentJobEntity>>;

    beforeEach(async () => {
      degradedJobRepo = createRepositoryMock<ContentJobEntity>();
      const jobEntity = createContentJobFixture({ status: JobStatus.QUEUED });
      degradedJobRepo.create.mockReturnValue(jobEntity as ContentJobEntity);
      degradedJobRepo.save.mockResolvedValue(jobEntity as ContentJobEntity);
      degradedJobRepo.update.mockResolvedValue({ affected: 1 } as never);

      degradedMetrics = {
        recordPipelineLatency: jest.fn(),
        recordQueueWaitTime: jest.fn(),
        setQueueDepth: jest.fn(),
        recordDegradation: jest.fn(),
      } as unknown as jest.Mocked<MetricsService>;

      const brand = createBrandFixture();

      const degradedModule: TestingModule = await Test.createTestingModule({
        providers: [
          ContentPipelineProcessor,
          { provide: getRepositoryToken(ContentJobEntity), useValue: degradedJobRepo },
          { provide: BrandsService, useValue: { findById: jest.fn().mockResolvedValue(brand) } },
          {
            provide: AgentOrchestratorService,
            useValue: {
              run: jest.fn().mockImplementation(async (ctx: AgentContext) => {
                // Simulate orchestrator reading ctx.degradation and reflecting it in result
                return {
                  ...buildResult(),
                  degraded: ctx.degradation.isDegraded,
                  degradationReasons: [...ctx.degradation.reasons],
                };
              }),
            },
          },
          {
            provide: StreamingService,
            useValue: { emit: jest.fn(), close: jest.fn(), isActive: jest.fn().mockReturnValue(true) },
          },
          { provide: EvaluationService, useValue: { evaluate: jest.fn().mockResolvedValue(undefined) } },
          { provide: MetricsService, useValue: degradedMetrics },
          {
            provide: QueueService,
            useValue: { getDepth: jest.fn().mockResolvedValue(100), enqueue: jest.fn() },
          },
          {
            provide: DegradationService,
            useValue: { isQueueOverloaded: jest.fn().mockReturnValue(true) },
          },
        ],
      }).compile();

      degradedProcessor = degradedModule.get(ContentPipelineProcessor);
    });

    it('emits queue_overload degradation metric when queue depth exceeds threshold', async () => {
      await degradedProcessor.process(buildBullJob() as Job);
      expect(degradedMetrics.recordDegradation).toHaveBeenCalledWith('queue_overload');
    });

    it('still transitions job to DONE when pipeline completes in degraded mode', async () => {
      await degradedProcessor.process(buildBullJob() as Job);
      const statuses = (
        degradedJobRepo.update.mock.calls as unknown as Array<[unknown, { status: string }]>
      ).map(([, p]) => p.status);
      expect(statuses).toContain(JobStatus.DONE);
    });

    it('persists degraded: true and queue_overload reason in the job result', async () => {
      await degradedProcessor.process(buildBullJob() as Job);
      const resultUpdate = (
        degradedJobRepo.update.mock.calls as unknown as Array<[unknown, Record<string, unknown>]>
      ).find(([, p]) => (p['result'] as { degraded?: boolean } | undefined)?.degraded === true);

      expect(resultUpdate).toBeDefined();
      const result = resultUpdate![1]['result'] as { degradationReasons: string[] };
      expect(result.degradationReasons).toContain('queue_overload');
    });

    it('does not call recordDegradation when no degradation reasons are accumulated', async () => {
      // Separate processor with DegradationService returning false (not overloaded)
      const cleanJobRepo = createRepositoryMock<ContentJobEntity>();
      const cleanJobEntity = createContentJobFixture({ status: JobStatus.QUEUED });
      cleanJobRepo.create.mockReturnValue(cleanJobEntity as ContentJobEntity);
      cleanJobRepo.save.mockResolvedValue(cleanJobEntity as ContentJobEntity);
      cleanJobRepo.update.mockResolvedValue({ affected: 1 } as never);

      const cleanMetrics = { recordPipelineLatency: jest.fn(), recordDegradation: jest.fn() } as unknown as jest.Mocked<MetricsService>;
      const brand = createBrandFixture();

      const cleanModule = await Test.createTestingModule({
        providers: [
          ContentPipelineProcessor,
          { provide: getRepositoryToken(ContentJobEntity), useValue: cleanJobRepo },
          { provide: BrandsService, useValue: { findById: jest.fn().mockResolvedValue(brand) } },
          { provide: AgentOrchestratorService, useValue: { run: jest.fn().mockResolvedValue(buildResult()) } },
          { provide: StreamingService, useValue: { emit: jest.fn(), close: jest.fn() } },
          { provide: EvaluationService, useValue: { evaluate: jest.fn().mockResolvedValue(undefined) } },
          { provide: MetricsService, useValue: cleanMetrics },
          { provide: QueueService, useValue: { getDepth: jest.fn().mockResolvedValue(1) } },
          { provide: DegradationService, useValue: { isQueueOverloaded: jest.fn().mockReturnValue(false) } },
        ],
      }).compile();

      const cleanProcessor = cleanModule.get(ContentPipelineProcessor);
      await cleanProcessor.process(buildBullJob() as Job);

      expect(cleanMetrics.recordDegradation).not.toHaveBeenCalled();
    });
  });
});
