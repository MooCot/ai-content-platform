import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import pLimit from 'p-limit';
import { ContentJobEntity } from './entities/content-job.entity';
import { GenerateContentDto } from './dto/content.dto';
import { BrandsService } from '../brands/brands.service';
import { AgentOrchestratorService } from '../agents/orchestrator/agent-orchestrator.service';
import { StreamingService } from '../streaming/streaming.service';
import { AgentContext } from '../agents/context/agent-context';
import { BrandId, ContentType, JobId, JobStatus } from '../common/types/domain.types';
import { ContentJobNotFoundException } from '../common/exceptions/domain.exceptions';

// Max simultaneous agent pipelines in this process instance.
// Prevents 100 concurrent jobs from hammering LLM rate limits.
const MAX_CONCURRENT_PIPELINES = 5;

@Injectable()
export class ContentService implements OnModuleInit {
  private readonly logger = new Logger(ContentService.name);
  private readonly limit = pLimit(MAX_CONCURRENT_PIPELINES);

  constructor(
    @InjectRepository(ContentJobEntity)
    private readonly jobRepo: Repository<ContentJobEntity>,
    private readonly brandsService: BrandsService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly streaming: StreamingService,
  ) {}

  // ── Fix 1: zombie-job cleanup ──────────────────────────────────────────────
  // Any job left RUNNING when the server starts never finished — mark it FAILED.
  async onModuleInit(): Promise<void> {
    const { affected } = await this.jobRepo.update(
      { status: JobStatus.RUNNING },
      { status: JobStatus.FAILED, errorMessage: 'Server restarted while job was running' },
    );
    if (affected && affected > 0) {
      this.logger.warn(`Marked ${affected} zombie job(s) as FAILED on startup`);
    }
  }

  async createJob(brandId: BrandId, dto: GenerateContentDto): Promise<ContentJobEntity> {
    const brand = await this.brandsService.findById(brandId);

    const job = this.jobRepo.create({
      brandId,
      topic: dto.topic,
      contentType: dto.contentType,
      status: JobStatus.QUEUED,
    });
    await this.jobRepo.save(job);

    this.logger.log(`Content job created: ${job.id} (brand: ${brandId})`);

    // ── Fix 2: concurrency semaphore ────────────────────────────────────────
    // p-limit queues the call until a slot is free — at most MAX_CONCURRENT_PIPELINES
    // pipelines run simultaneously, the rest wait in-process.
    void this.limit(() => this.runPipeline(job.id, brand, dto));

    return job;
  }

  async getJob(jobId: JobId, brandId: BrandId): Promise<ContentJobEntity> {
    const job = await this.jobRepo.findOne({ where: { id: jobId, brandId } });
    if (!job) throw new ContentJobNotFoundException(jobId);
    return job;
  }

  async listJobs(brandId: BrandId): Promise<ContentJobEntity[]> {
    return this.jobRepo.find({
      where: { brandId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  private async runPipeline(
    jobId: JobId,
    brand: Awaited<ReturnType<BrandsService['findById']>>,
    dto: GenerateContentDto,
  ): Promise<void> {
    await this.jobRepo.update(jobId, { status: JobStatus.RUNNING });

    const ctx = new AgentContext({
      jobId,
      brandId: brand.id,
      brandConfig: brand.config,
      topic: dto.topic,
      contentType: dto.contentType as ContentType,
    });

    try {
      const result = await this.orchestrator.run(ctx);

      await this.jobRepo.update(jobId, {
        status: ctx.isCancelled ? JobStatus.CANCELLED : JobStatus.DONE,
        result,
        agentTrace: ctx.steps,
      });

      this.streaming.emit(jobId, {
        type: 'job_done',
        data: { jobId, status: JobStatus.DONE, result },
        jobId,
      });

      this.streaming.close(jobId);
    } catch (err) {
      this.logger.error(`Pipeline failed for job ${jobId}`, err);
      await this.jobRepo.update(jobId, {
        status: JobStatus.FAILED,
        errorMessage: String(err),
        agentTrace: ctx.steps,
      });

      this.streaming.emit(jobId, {
        type: 'error',
        data: { jobId, error: String(err) },
        jobId,
      });

      this.streaming.close(jobId);
    }
  }
}
