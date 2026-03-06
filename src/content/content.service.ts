import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentJobEntity } from './entities/content-job.entity';
import { GenerateContentDto } from './dto/content.dto';
import { BrandsService } from '../brands/brands.service';
import { AgentOrchestratorService } from '../agents/orchestrator/agent-orchestrator.service';
import { StreamingService } from '../streaming/streaming.service';
import { AgentContext } from '../agents/context/agent-context';
import { BrandId, ContentType, JobId, JobStatus } from '../common/types/domain.types';
import { ContentJobNotFoundException } from '../common/exceptions/domain.exceptions';

@Injectable()
export class ContentService {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @InjectRepository(ContentJobEntity)
    private readonly jobRepo: Repository<ContentJobEntity>,
    private readonly brandsService: BrandsService,
    private readonly orchestrator: AgentOrchestratorService,
    private readonly streaming: StreamingService,
  ) {}

  async createJob(brandId: BrandId, dto: GenerateContentDto): Promise<ContentJobEntity> {
    // Validate brand exists
    const brand = await this.brandsService.findById(brandId);

    const job = this.jobRepo.create({
      brandId,
      topic: dto.topic,
      contentType: dto.contentType,
      status: JobStatus.QUEUED,
    });
    await this.jobRepo.save(job);

    this.logger.log(`Content job created: ${job.id} (brand: ${brandId})`);

    // Fire-and-forget: run pipeline async without blocking the HTTP response
    void this.runPipeline(job.id, brand, dto);

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
    // Update status to RUNNING
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
