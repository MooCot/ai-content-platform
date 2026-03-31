import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContentPipelineProcessor } from './content-pipeline.processor';
import { ContentJobEntity } from '../../content/entities/content-job.entity';
import { BrandsService } from '../../brands/brands.service';
import { AgentOrchestratorService } from '../../agents/orchestrator/agent-orchestrator.service';
import { StreamingService } from '../../streaming/streaming.service';
import { EvaluationService } from '../../evaluation/evaluation.service';
import { MetricsService } from '../../observability/metrics.service';
import { QueueService } from '../queue.service';
import { DegradationService } from '../../resilience/degradation.service';
import { JobStatus, ContentType, Tone } from '../../common/types/domain.types';
import { createRepositoryMock } from '../../../test/utils/repository.mock';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';
import { Job } from 'bullmq';
import { AgentContext } from '../../agents/context/agent-context';

function buildJob(overrides = {}): Partial<Job> {
  return {
    data: {
      jobId: 'job-1',
      brandId: 'brand-test-uuid',
      dto: { topic: 'Vector DBs', contentType: ContentType.BLOG },
      correlationId: 'corr-1',
    },
    attemptsMade: 0,
    opts: { attempts: 3 },
    timestamp: Date.now() - 500,
    ...overrides,
  };
}

function buildResult() {
  return {
    raw: 'draft',
    optimized: 'optimized',
    seoKeywords: ['kw'],
    readabilityScore: 75,
    toneAnalysis: { detected: Tone.TECHNICAL, confidence: 0.9, scores: {} as never },
    wordCount: 200,
    citations: [],
  };
}

describe('ContentPipelineProcessor', () => {
  let processor: ContentPipelineProcessor;
  let repoMock: ReturnType<typeof createRepositoryMock<ContentJobEntity>>;
  let orchestratorMock: jest.Mocked<AgentOrchestratorService>;
  let streamingMock: jest.Mocked<StreamingService>;
  let evaluationMock: jest.Mocked<EvaluationService>;
  let metricsMock: jest.Mocked<MetricsService>;
  let brandsServiceMock: jest.Mocked<BrandsService>;

  beforeEach(async () => {
    repoMock = createRepositoryMock<ContentJobEntity>();
    orchestratorMock = {
      run: jest.fn().mockResolvedValue(buildResult()),
    } as unknown as jest.Mocked<AgentOrchestratorService>;
    streamingMock = {
      emit: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<StreamingService>;
    evaluationMock = {
      evaluate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EvaluationService>;
    metricsMock = {
      recordPipelineLatency: jest.fn(),
      recordQueueWaitTime: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;
    brandsServiceMock = {
      findById: jest.fn().mockResolvedValue(createBrandFixture()),
    } as unknown as jest.Mocked<BrandsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentPipelineProcessor,
        { provide: getRepositoryToken(ContentJobEntity), useValue: repoMock },
        { provide: BrandsService, useValue: brandsServiceMock },
        { provide: AgentOrchestratorService, useValue: orchestratorMock },
        { provide: StreamingService, useValue: streamingMock },
        { provide: EvaluationService, useValue: evaluationMock },
        { provide: MetricsService, useValue: metricsMock },
      ],
    }).compile();

    processor = module.get(ContentPipelineProcessor);
  });

  // ── process() ─────────────────────────────────────────────────────────────

  describe('process()', () => {
    it('transitions job status to RUNNING on start', async () => {
      await processor.process(buildJob() as Job);
      expect(repoMock.update).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ status: JobStatus.RUNNING }),
      );
    });

    it('transitions job status to DONE on success', async () => {
      await processor.process(buildJob() as Job);
      const donePatch = (
        repoMock.update.mock.calls as unknown as Array<[string, { status: string }]>
      ).find(([, p]) => p.status === JobStatus.DONE);
      expect(donePatch).toBeDefined();
    });

    it('emits job_done SSE event on success', async () => {
      await processor.process(buildJob() as Job);
      expect(streamingMock.emit).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ type: 'job_done' }),
      );
    });

    it('closes the stream after completion', async () => {
      await processor.process(buildJob() as Job);
      expect(streamingMock.close).toHaveBeenCalledWith('job-1');
    });

    it('records pipeline latency metric', async () => {
      await processor.process(buildJob() as Job);
      expect(metricsMock.recordPipelineLatency).toHaveBeenCalledWith(
        ContentType.BLOG,
        expect.any(Number),
      );
    });

    it('fires evaluation as fire-and-forget (does not await)', async () => {
      // If evaluation blocks, the test would time out — it must return promptly
      evaluationMock.evaluate.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5_000)),
      );
      await expect(processor.process(buildJob() as Job)).resolves.toBeUndefined();
    });

    it('transitions to CANCELLED when context is cancelled mid-pipeline', async () => {
      orchestratorMock.run.mockImplementation(async (ctx) => {
        ctx.cancel();
        return buildResult();
      });
      await processor.process(buildJob() as Job);
      const cancelledPatch = (
        repoMock.update.mock.calls as unknown as Array<[string, { status: string }]>
      ).find(([, p]) => p.status === JobStatus.CANCELLED);
      expect(cancelledPatch).toBeDefined();
    });
  });

  // ── onFailed() ────────────────────────────────────────────────────────────

  describe('onFailed()', () => {
    it('sets status to RETRYING when attempts remain', () => {
      const job = buildJob({ attemptsMade: 1, opts: { attempts: 3 } }) as Job;
      processor.onFailed(job, new Error('transient error'));
      expect(repoMock.update).toHaveBeenCalledWith('job-1', { status: JobStatus.RETRYING });
    });

    it('sets status to FAILED and emits error event on final attempt', () => {
      const job = buildJob({ attemptsMade: 3, opts: { attempts: 3 } }) as Job;
      processor.onFailed(job, new Error('permanent failure'));

      const failedCall = (
        repoMock.update.mock.calls as unknown as Array<[string, { status: string }]>
      ).find(([, p]) => p.status === JobStatus.FAILED);
      expect(failedCall).toBeDefined();
      expect(streamingMock.emit).toHaveBeenCalledWith(
        'job-1',
        expect.objectContaining({ type: 'error' }),
      );
      expect(streamingMock.close).toHaveBeenCalledWith('job-1');
    });

    it('is a no-op when job is undefined (guard)', () => {
      expect(() => processor.onFailed(undefined, new Error('x'))).not.toThrow();
    });
  });

  // ── onActive() ────────────────────────────────────────────────────────────

  describe('onActive()', () => {
    it('records queue wait time metric', () => {
      const job = buildJob({ timestamp: Date.now() - 1000 }) as Job;
      processor.onActive(job);
      expect(metricsMock.recordQueueWaitTime).toHaveBeenCalledWith(expect.any(Number));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Degradation integration
// ─────────────────────────────────────────────────────────────────────────────

describe('ContentPipelineProcessor — degradation', () => {
  let processor: ContentPipelineProcessor;
  let repoMock: ReturnType<typeof createRepositoryMock<ContentJobEntity>>;
  let orchestratorMock: jest.Mocked<AgentOrchestratorService>;
  let streamingMock: jest.Mocked<StreamingService>;
  let evaluationMock: jest.Mocked<EvaluationService>;
  let metricsMock: jest.Mocked<MetricsService>;
  let brandsServiceMock: jest.Mocked<BrandsService>;
  let queueServiceMock: jest.Mocked<QueueService>;
  let degradationServiceMock: jest.Mocked<DegradationService>;

  function buildDegradedResult(reasons: string[]) {
    return {
      raw: 'draft',
      optimized: 'draft', // fell back — optimizer was skipped
      seoKeywords: [],
      readabilityScore: 0,
      toneAnalysis: { detected: Tone.TECHNICAL, confidence: 0.9, scores: {} as never },
      wordCount: 1,
      citations: [],
      degraded: true,
      degradationReasons: reasons,
    };
  }

  beforeEach(async () => {
    repoMock = createRepositoryMock<ContentJobEntity>();
    orchestratorMock = {
      run: jest
        .fn()
        .mockResolvedValue(buildDegradedResult(['queue_overload', 'optional_agent_skipped'])),
    } as unknown as jest.Mocked<AgentOrchestratorService>;
    streamingMock = {
      emit: jest.fn(),
      close: jest.fn(),
    } as unknown as jest.Mocked<StreamingService>;
    evaluationMock = {
      evaluate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EvaluationService>;
    metricsMock = {
      recordPipelineLatency: jest.fn(),
      recordQueueWaitTime: jest.fn(),
      recordDegradation: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;
    brandsServiceMock = {
      findById: jest.fn().mockResolvedValue(createBrandFixture()),
    } as unknown as jest.Mocked<BrandsService>;
    queueServiceMock = {
      getDepth: jest.fn().mockResolvedValue(30), // below threshold by default
    } as unknown as jest.Mocked<QueueService>;
    degradationServiceMock = {
      isQueueOverloaded: jest.fn().mockReturnValue(false),
      isLatencyBudgetExceeded: jest.fn().mockReturnValue(false),
      ragTimeout: 5_000,
    } as unknown as jest.Mocked<DegradationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentPipelineProcessor,
        { provide: getRepositoryToken(ContentJobEntity), useValue: repoMock },
        { provide: BrandsService, useValue: brandsServiceMock },
        { provide: AgentOrchestratorService, useValue: orchestratorMock },
        { provide: StreamingService, useValue: streamingMock },
        { provide: EvaluationService, useValue: evaluationMock },
        { provide: MetricsService, useValue: metricsMock },
        { provide: QueueService, useValue: queueServiceMock },
        { provide: DegradationService, useValue: degradationServiceMock },
      ],
    }).compile();

    processor = module.get(ContentPipelineProcessor);
  });

  // ── recordDegradation called per reason ────────────────────────────────

  it('calls recordDegradation once per reason accumulated during the run', async () => {
    // orchestratorMock returns a result with 2 reasons; but the processor reads
    // reasons from ctx.degradation, so we need to populate it via the orchestrator mock
    orchestratorMock.run.mockImplementation(async (ctx) => {
      ctx.degradation.append('queue_overload');
      ctx.degradation.append('optional_agent_skipped');
      return buildDegradedResult(['queue_overload', 'optional_agent_skipped']);
    });

    await processor.process(buildJob() as Job);

    expect(metricsMock.recordDegradation).toHaveBeenCalledTimes(2);
    expect(metricsMock.recordDegradation).toHaveBeenCalledWith('queue_overload');
    expect(metricsMock.recordDegradation).toHaveBeenCalledWith('optional_agent_skipped');
  });

  it('does not call recordDegradation on a clean (non-degraded) run', async () => {
    orchestratorMock.run.mockImplementation(async () => ({
      raw: 'r',
      optimized: 'o',
      seoKeywords: [],
      readabilityScore: 80,
      toneAnalysis: { detected: Tone.TECHNICAL, confidence: 0.9, scores: {} as never },
      wordCount: 1,
      citations: [],
      degraded: false,
      degradationReasons: [],
    }));

    await processor.process(buildJob() as Job);

    expect(metricsMock.recordDegradation).not.toHaveBeenCalled();
  });

  // ── Queue overload detection ───────────────────────────────────────────

  it('appends queue_overload to ctx when queue depth meets threshold', async () => {
    queueServiceMock.getDepth.mockResolvedValue(50);
    degradationServiceMock.isQueueOverloaded.mockReturnValue(true);

    let capturedCtx: AgentContext;
    orchestratorMock.run.mockImplementation(async (ctx) => {
      capturedCtx = ctx;
      return buildDegradedResult(['queue_overload']);
    });

    await processor.process(buildJob() as Job);

    expect(capturedCtx.degradation.reasons).toContain('queue_overload');
  });

  it('does not append queue_overload when depth is below threshold', async () => {
    queueServiceMock.getDepth.mockResolvedValue(10);
    degradationServiceMock.isQueueOverloaded.mockReturnValue(false);

    let capturedCtx: AgentContext;
    orchestratorMock.run.mockImplementation(async (ctx) => {
      capturedCtx = ctx;
      return buildDegradedResult([]);
    });

    await processor.process(buildJob() as Job);

    expect(capturedCtx.degradation.reasons).not.toContain('queue_overload');
  });

  it('checks queue depth before the orchestrator runs', async () => {
    const callOrder: string[] = [];
    queueServiceMock.getDepth.mockImplementation(async () => {
      callOrder.push('getDepth');
      return 30;
    });
    orchestratorMock.run.mockImplementation(async () => {
      callOrder.push('orchestrator');
      return buildDegradedResult([]);
    });

    await processor.process(buildJob() as Job);

    expect(callOrder.indexOf('getDepth')).toBeLessThan(callOrder.indexOf('orchestrator'));
  });
});
