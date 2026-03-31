import { Queue } from 'bullmq';
import { QueueService } from './queue.service';
import { MetricsService } from '../observability/metrics.service';
import { ContractViolationException } from '../common/exceptions/domain.exceptions';
import { ContentPipelineJobData, PIPELINE_JOB_OPTIONS } from './queue.constants';
import { ContentType } from '../common/types/domain.types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJobData(overrides: Partial<ContentPipelineJobData> = {}): ContentPipelineJobData {
  return {
    jobId: 'job-uuid-1',
    brandId: 'brand-uuid-1',
    dto: { topic: 'AI in healthcare', contentType: ContentType.BLOG },
    correlationId: 'corr-uuid-1',
    ...overrides,
  };
}

function makeQueueMock(jobId = 'bullmq-job-id') {
  return {
    add: jest.fn().mockResolvedValue({ id: jobId }),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0 }),
  };
}

function makeMetricsMock() {
  return { setQueueDepth: jest.fn() };
}

describe('QueueService', () => {
  let service: QueueService;
  let queue: ReturnType<typeof makeQueueMock>;
  let metrics: ReturnType<typeof makeMetricsMock>;

  beforeEach(() => {
    queue = makeQueueMock();
    metrics = makeMetricsMock();
    service = new QueueService(queue as unknown as Queue, metrics as unknown as MetricsService);
  });

  // ── enqueue() ─────────────────────────────────────────────────────────────

  describe('enqueue()', () => {
    it('returns the BullMQ job id on success', async () => {
      queue.add.mockResolvedValue({ id: 'returned-job-id' });
      const result = await service.enqueue(makeJobData());
      expect(result).toBe('returned-job-id');
    });

    it('calls queue.add with job name "generate"', async () => {
      await service.enqueue(makeJobData());
      expect(queue.add).toHaveBeenCalledWith('generate', expect.anything(), expect.anything());
    });

    it('passes the original data (not enriched) to queue.add', async () => {
      const data = makeJobData();
      await service.enqueue(data);
      const [, passedData] = queue.add.mock.calls[0];
      expect(passedData).toBe(data);
    });

    it('uses jobId as the BullMQ job id for idempotency', async () => {
      const data = makeJobData({ jobId: 'my-idempotent-id' });
      await service.enqueue(data);
      const [, , options] = queue.add.mock.calls[0];
      expect(options.jobId).toBe('my-idempotent-id');
    });

    it('merges PIPELINE_JOB_OPTIONS into the add call', async () => {
      await service.enqueue(makeJobData());
      const [, , options] = queue.add.mock.calls[0];
      expect(options.attempts).toBe(PIPELINE_JOB_OPTIONS.attempts);
      expect(options.backoff).toEqual(PIPELINE_JOB_OPTIONS.backoff);
    });

    it('throws ContractViolationException for invalid payload (empty jobId)', async () => {
      const bad = makeJobData({ jobId: '' });
      await expect(service.enqueue(bad)).rejects.toThrow(ContractViolationException);
    });

    it('throws ContractViolationException for invalid payload (empty brandId)', async () => {
      const bad = makeJobData({ brandId: '' });
      await expect(service.enqueue(bad)).rejects.toThrow(ContractViolationException);
    });

    it('throws ContractViolationException for invalid payload (empty topic)', async () => {
      const bad = makeJobData({ dto: { topic: '', contentType: ContentType.BLOG } });
      await expect(service.enqueue(bad)).rejects.toThrow(ContractViolationException);
    });

    it('does NOT call queue.add when contract validation fails', async () => {
      const bad = makeJobData({ jobId: '' });
      await expect(service.enqueue(bad)).rejects.toThrow();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('updates queue depth metric after successful enqueue', async () => {
      queue.getJobCounts.mockResolvedValue({ waiting: 3, active: 1, delayed: 0 });
      await service.enqueue(makeJobData());
      // setQueueDepth is fire-and-forget — flush microtasks
      await Promise.resolve();
      expect(metrics.setQueueDepth).toHaveBeenCalledWith(4);
    });
  });

  // ── getDepth() ────────────────────────────────────────────────────────────

  describe('getDepth()', () => {
    it('returns sum of waiting + active + delayed', async () => {
      queue.getJobCounts.mockResolvedValue({ waiting: 10, active: 3, delayed: 2 });
      const depth = await service.getDepth();
      expect(depth).toBe(15);
    });

    it('returns 0 when queue is empty', async () => {
      queue.getJobCounts.mockResolvedValue({ waiting: 0, active: 0, delayed: 0 });
      const depth = await service.getDepth();
      expect(depth).toBe(0);
    });

    it('calls getJobCounts with waiting, active, and delayed', async () => {
      await service.getDepth();
      expect(queue.getJobCounts).toHaveBeenCalledWith('waiting', 'active', 'delayed');
    });

    it('handles missing count keys gracefully (defaults to 0)', async () => {
      queue.getJobCounts.mockResolvedValue({});
      const depth = await service.getDepth();
      expect(depth).toBe(0);
    });
  });
});
