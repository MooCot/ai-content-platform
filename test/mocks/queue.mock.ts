import { ContentPipelineJobData } from '../../src/queue/queue.constants';

/**
 * Minimal mock for QueueService — captures enqueued jobs for assertion.
 */
export class MockQueueService {
  private readonly enqueuedJobs: ContentPipelineJobData[] = [];

  async enqueue(data: ContentPipelineJobData): Promise<string> {
    this.enqueuedJobs.push(data);
    return data.jobId;
  }

  async getDepth(): Promise<number> {
    return this.enqueuedJobs.length;
  }

  /** Test helper: return all enqueued job data. */
  getEnqueuedJobs(): ContentPipelineJobData[] {
    return [...this.enqueuedJobs];
  }

  /** Test helper: clear captured jobs. */
  reset(): void {
    this.enqueuedJobs.length = 0;
  }
}
