import { Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ContentJobEntity } from '../../content/entities/content-job.entity';
import { BrandsService } from '../../brands/brands.service';
import { AgentOrchestratorService } from '../../agents/orchestrator/agent-orchestrator.service';
import { StreamingService } from '../../streaming/streaming.service';
import { EvaluationService } from '../../evaluation/evaluation.service';
import { MetricsService } from '../../observability/metrics.service';
import { AgentContext } from '../../agents/context/agent-context';
import { ContentType, JobStatus } from '../../common/types/domain.types';
import { CONTENT_PIPELINE_QUEUE, ContentPipelineJobData } from '../queue.constants';
import { QueueService } from '../queue.service';
import { DegradationService } from '../../resilience/degradation.service';

@Processor(CONTENT_PIPELINE_QUEUE, { concurrency: 5 })
export class ContentPipelineProcessor extends WorkerHost {
  private readonly logger = new Logger(ContentPipelineProcessor.name);

  constructor(
    @InjectRepository(ContentJobEntity)
    private readonly jobRepo: Repository<ContentJobEntity>,
    private readonly brands: BrandsService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly streaming: StreamingService,
    private readonly evaluation: EvaluationService,
    private readonly metrics: MetricsService,
    // Optional so existing unit tests that don't wire these services still pass
    @Optional() private readonly queueService?: QueueService,
    @Optional() private readonly degradationService?: DegradationService,
  ) {
    super();
  }

  async process(job: Job<ContentPipelineJobData>): Promise<void> {
    const { jobId, brandId, dto, correlationId } = job.data;
    this.logger.log(`[${jobId}] Processing pipeline (attempt ${job.attemptsMade + 1})`);

    await this.jobRepo.update(jobId, {
      status: JobStatus.RUNNING,
      attempts: job.attemptsMade + 1,
    });

    const brand = await this.brands.findById(brandId);
    const ctx = new AgentContext({
      jobId,
      brandId: brand.id,
      brandConfig: brand.config,
      topic: dto.topic,
      contentType: dto.contentType as ContentType,
      correlationId,
    });

    // Queue overload check — mark context degraded before the pipeline starts
    // so the orchestrator can skip optional agents without being aware of BullMQ.
    if (this.queueService && this.degradationService) {
      const depth = await this.queueService.getDepth();
      if (this.degradationService.isQueueOverloaded(depth)) {
        this.logger.warn(`[${jobId}] Queue overloaded (depth=${depth}) — entering degraded mode`);
        ctx.degradation.append('queue_overload');
      }
    }

    const pipelineStart = Date.now();
    const result = await this.orchestrator.run(ctx);
    const durationMs = Date.now() - pipelineStart;

    // Emit one Prometheus increment per degradation reason accumulated during the run
    for (const reason of ctx.degradation.reasons) {
      this.metrics.recordDegradation(reason);
    }

    // TypeORM _QueryDeepPartialEntity doesn't handle JSONB Record fields — cast to bypass
    await this.jobRepo.update(jobId, {
      status: ctx.isCancelled ? JobStatus.CANCELLED : JobStatus.DONE,
      result: result as unknown as typeof result,
      agentTrace: ctx.steps as unknown as typeof ctx.steps,
    } as Parameters<typeof this.jobRepo.update>[1]);

    this.streaming.emit(jobId, {
      type: 'job_done',
      data: { jobId, status: JobStatus.DONE, result },
      jobId,
    });
    this.streaming.close(jobId);

    this.metrics.recordPipelineLatency(dto.contentType, durationMs);

    // Fire-and-forget: evaluation never blocks the pipeline response
    void this.evaluation
      .evaluate(ctx, result)
      .catch((err) => this.logger.error(`[${jobId}] Post-pipeline evaluation failed`, String(err)));
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<ContentPipelineJobData> | undefined, err: Error): void {
    if (!job) return;

    const { jobId } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    const isFinal = job.attemptsMade >= maxAttempts;

    this.logger.error(
      `[${jobId}] Attempt ${job.attemptsMade}/${maxAttempts} failed (final=${isFinal}): ${err.message}`,
    );

    if (isFinal) {
      void this.jobRepo.update(jobId, {
        status: JobStatus.FAILED,
        errorMessage: err.message,
      });
      this.streaming.emit(jobId, {
        type: 'error',
        data: { jobId, error: err.message },
        jobId,
      });
      this.streaming.close(jobId);
    } else {
      void this.jobRepo.update(jobId, { status: JobStatus.RETRYING });
    }
  }

  @OnWorkerEvent('active')
  onActive(job: Job<ContentPipelineJobData>): void {
    // job.timestamp = epoch ms when the job was added; approximate queue wait time
    this.metrics.recordQueueWaitTime(Date.now() - job.timestamp);
  }
}
