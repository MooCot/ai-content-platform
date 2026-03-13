import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ContentJobEntity } from './entities/content-job.entity';
import { GenerateContentDto } from './dto/content.dto';
import { BrandsService } from '../brands/brands.service';
import { QueueService } from '../queue/queue.service';
import { BrandId, JobId, JobStatus } from '../common/types/domain.types';
import { ContentJobNotFoundException } from '../common/exceptions/domain.exceptions';

@Injectable()
export class ContentService implements OnModuleInit {
  private readonly logger = new Logger(ContentService.name);

  constructor(
    @InjectRepository(ContentJobEntity)
    private readonly jobRepo: Repository<ContentJobEntity>,
    private readonly brandsService: BrandsService,
    private readonly queue: QueueService,
  ) {}

  // ── Fix: zombie-job cleanup ────────────────────────────────────────────────
  // Any job left RUNNING when the server starts never finished — mark it FAILED.
  // BullMQ handles its own stalled-job re-queue; this keeps Postgres consistent.
  async onModuleInit(): Promise<void> {
    const { affected } = await this.jobRepo.update(
      { status: JobStatus.RUNNING },
      { status: JobStatus.FAILED, errorMessage: 'Server restarted while job was running' },
    );
    if (affected && affected > 0) {
      this.logger.warn(`Marked ${affected} zombie job(s) as FAILED on startup`);
    }
  }

  async createJob(
    brandId: BrandId,
    dto: GenerateContentDto,
    correlationId: string,
  ): Promise<ContentJobEntity> {
    // Validate brand exists — fail fast before touching the queue
    await this.brandsService.findById(brandId);

    const job = this.jobRepo.create({
      brandId,
      topic: dto.topic,
      contentType: dto.contentType,
      status: JobStatus.QUEUED,
      correlationId,
    });
    await this.jobRepo.save(job);

    await this.queue.enqueue({ jobId: job.id, brandId, dto, correlationId });

    this.logger.log(
      `Content job queued: ${job.id} (brand: ${brandId}, correlation: ${correlationId})`,
    );
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
}
