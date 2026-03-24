import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ContentService } from './content.service';
import { ContentJobEntity } from './entities/content-job.entity';
import { BrandsService } from '../brands/brands.service';
import { QueueService } from '../queue/queue.service';
import { ContentType, JobStatus } from '../common/types/domain.types';
import { ContentJobNotFoundException } from '../common/exceptions/domain.exceptions';
import { createRepositoryMock } from '../../test/utils/repository.mock';
import { createBrandFixture } from '../../test/fixtures/brand.fixture';
import { createContentJobFixture } from '../../test/fixtures/content-job.fixture';
import { MockQueueService } from '../../test/mocks/queue.mock';

describe('ContentService', () => {
  let service: ContentService;
  let repoMock: ReturnType<typeof createRepositoryMock<ContentJobEntity>>;
  let brandsServiceMock: jest.Mocked<BrandsService>;
  let queueService: MockQueueService;

  beforeEach(async () => {
    repoMock = createRepositoryMock<ContentJobEntity>();
    brandsServiceMock = { findById: jest.fn() } as unknown as jest.Mocked<BrandsService>;
    queueService = new MockQueueService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContentService,
        { provide: getRepositoryToken(ContentJobEntity), useValue: repoMock },
        { provide: BrandsService, useValue: brandsServiceMock },
        { provide: QueueService, useValue: queueService },
      ],
    }).compile();

    service = module.get(ContentService);
  });

  // ── onModuleInit() — zombie job cleanup ────────────────────────────────────

  describe('onModuleInit()', () => {
    it('marks RUNNING jobs as FAILED on startup', async () => {
      repoMock.update.mockResolvedValue({ affected: 2 } as never);
      await service.onModuleInit();
      expect(repoMock.update).toHaveBeenCalledWith(
        { status: JobStatus.RUNNING },
        expect.objectContaining({ status: JobStatus.FAILED }),
      );
    });

    it('does not warn when no zombie jobs exist', async () => {
      repoMock.update.mockResolvedValue({ affected: 0 } as never);
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  // ── createJob() ───────────────────────────────────────────────────────────

  describe('createJob()', () => {
    const dto = { topic: 'Vector DBs', contentType: ContentType.BLOG };
    const brand = createBrandFixture();

    beforeEach(() => {
      brandsServiceMock.findById.mockResolvedValue(brand);
      const jobEntity = createContentJobFixture({ status: JobStatus.QUEUED });
      repoMock.create.mockReturnValue(jobEntity as ContentJobEntity);
      repoMock.save.mockResolvedValue(jobEntity as ContentJobEntity);
    });

    it('validates brand exists before creating a job', async () => {
      await service.createJob(brand.id, dto, 'corr-1');
      expect(brandsServiceMock.findById).toHaveBeenCalledWith(brand.id);
    });

    it('saves a QUEUED job entity', async () => {
      await service.createJob(brand.id, dto, 'corr-1');
      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: JobStatus.QUEUED }),
      );
      expect(repoMock.save).toHaveBeenCalled();
    });

    it('enqueues the job into BullMQ with the correct jobId', async () => {
      const job = await service.createJob(brand.id, dto, 'corr-1');
      const enqueued = queueService.getEnqueuedJobs();
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0].jobId).toBe(job.id);
      expect(enqueued[0].brandId).toBe(brand.id);
      expect(enqueued[0].correlationId).toBe('corr-1');
    });

    it('throws BrandNotFoundException when brand does not exist', async () => {
      const { BrandNotFoundException } = await import('../common/exceptions/domain.exceptions');
      brandsServiceMock.findById.mockRejectedValue(new BrandNotFoundException('bad-id'));

      await expect(service.createJob('bad-id', dto, 'corr-1')).rejects.toThrow(
        BrandNotFoundException,
      );
      // Queue must NOT be touched on brand validation failure
      expect(queueService.getEnqueuedJobs()).toHaveLength(0);
    });
  });

  // ── getJob() ──────────────────────────────────────────────────────────────

  describe('getJob()', () => {
    it('returns the job when found', async () => {
      const job = createContentJobFixture();
      repoMock.findOne.mockResolvedValue(job as ContentJobEntity);

      const result = await service.getJob(job.id, job.brandId);
      expect(result).toBe(job);
    });

    it('throws ContentJobNotFoundException when job not found', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await expect(service.getJob('missing', 'brand-1')).rejects.toThrow(
        ContentJobNotFoundException,
      );
    });

    it('scopes the query to the brandId (invariant: brand isolation)', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await service.getJob('job-1', 'brand-1').catch(() => {});
      expect(repoMock.findOne).toHaveBeenCalledWith({
        where: { id: 'job-1', brandId: 'brand-1' },
      });
    });
  });

  // ── listJobs() ────────────────────────────────────────────────────────────

  describe('listJobs()', () => {
    it('returns jobs scoped to the brandId (invariant: brand isolation)', async () => {
      repoMock.find.mockResolvedValue([]);
      await service.listJobs('brand-1');
      expect(repoMock.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { brandId: 'brand-1' }, take: 50 }),
      );
    });
  });
});
