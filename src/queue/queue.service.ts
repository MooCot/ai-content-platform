import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MetricsService } from '../observability/metrics.service';
import {
  CONTENT_PIPELINE_QUEUE,
  PIPELINE_JOB_OPTIONS,
  ContentPipelineJobData,
} from './queue.constants';

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(CONTENT_PIPELINE_QUEUE)
    private readonly queue: Queue<ContentPipelineJobData>,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Enqueue a content generation job.
   * Using `jobId` as the BullMQ job ID makes enqueue idempotent —
   * re-submitting the same jobId is a no-op if the job already exists.
   */
  async enqueue(data: ContentPipelineJobData): Promise<string> {
    const job = await this.queue.add('generate', data, {
      ...PIPELINE_JOB_OPTIONS,
      jobId: data.jobId,
    });

    void this.getDepth().then((d) => this.metrics.setQueueDepth(d));
    return job.id!;
  }

  async getDepth(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'active', 'delayed');
    return (counts['waiting'] ?? 0) + (counts['active'] ?? 0) + (counts['delayed'] ?? 0);
  }
}
