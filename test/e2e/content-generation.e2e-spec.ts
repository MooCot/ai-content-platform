import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestApp } from '../utils/test-app.factory';
import { createBrandFixture } from '../fixtures/brand.fixture';
import { createContentJobFixture } from '../fixtures/content-job.fixture';
import { ContentType, JobStatus } from '../../src/common/types/domain.types';

describe('Content Generation E2E', () => {
  let testApp: TestApp;
  let app: INestApplication;
  const brand = createBrandFixture();

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Default: brand exists
    testApp.brandRepo.findOne.mockResolvedValue(brand);
    // Default: job repo returns a queued job
    const job = createContentJobFixture({ status: JobStatus.QUEUED });
    testApp.jobRepo.create.mockReturnValue(job);
    testApp.jobRepo.save.mockResolvedValue(job);
    testApp.jobRepo.update.mockResolvedValue({ affected: 1 } as never);
    testApp.queueService.reset();
  });

  // ── POST /brands/:brandId/content/generate ─────────────────────────────────

  describe('POST /api/v1/brands/:brandId/content/generate', () => {
    const dto = { topic: 'Vector Databases', contentType: ContentType.BLOG };

    it('returns 201 with a job entity in QUEUED status', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/content/generate`)
        .send(dto)
        .expect(201);

      expect(res.body).toHaveProperty('jobId');
      expect(res.body.status).toBe(JobStatus.QUEUED);
    });

    it('enqueues exactly one BullMQ job with matching brandId', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/content/generate`)
        .send(dto)
        .expect(201);

      const enqueued = testApp.queueService.getEnqueuedJobs();
      expect(enqueued).toHaveLength(1);
      expect(enqueued[0].brandId).toBe(brand.id);
    });

    it('returns 404 when brand does not exist', async () => {
      testApp.brandRepo.findOne.mockResolvedValue(null);
      await request(app.getHttpServer())
        .post('/api/v1/brands/c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13/content/generate')
        .send(dto)
        .expect(404);
    });

    it('returns 400 when topic is missing', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/content/generate`)
        .send({ contentType: ContentType.BLOG })
        .expect(400);
    });

    it('returns 400 when contentType is invalid', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/content/generate`)
        .send({ topic: 'Test', contentType: 'INVALID_TYPE' })
        .expect(400);
    });
  });

  // ── GET /brands/:brandId/content ───────────────────────────────────────────

  describe('GET /api/v1/brands/:brandId/content', () => {
    it('returns the list of jobs for the brand', async () => {
      const job = createContentJobFixture({ status: JobStatus.DONE });
      testApp.jobRepo.find.mockResolvedValue([job]);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/brands/${brand.id}/content`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].id).toBe(job.id);
    });

    it('returns empty array when no jobs exist', async () => {
      testApp.jobRepo.find.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get(`/api/v1/brands/${brand.id}/content`)
        .expect(200);
      expect(res.body).toHaveLength(0);
    });
  });

  // ── GET /brands/:brandId/content/:jobId ────────────────────────────────────

  describe('GET /api/v1/brands/:brandId/content/:jobId', () => {
    it('returns the job when found', async () => {
      const job = createContentJobFixture({ status: JobStatus.DONE });
      testApp.jobRepo.findOne.mockResolvedValue(job);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/brands/${brand.id}/content/${job.id}`)
        .expect(200);

      expect(res.body.id).toBe(job.id);
      expect(res.body.status).toBe(JobStatus.DONE);
    });

    it('returns 404 for an unknown jobId', async () => {
      testApp.jobRepo.findOne.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get(`/api/v1/brands/${brand.id}/content/e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15`)
        .expect(404);
    });

    it('is brand-scoped — same jobId under different brand returns 404', async () => {
      testApp.jobRepo.findOne.mockResolvedValue(null); // job not found for this brand
      const job = createContentJobFixture({ status: JobStatus.DONE });
      await request(app.getHttpServer())
        .get(`/api/v1/brands/d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/content/${job.id}`)
        .expect(404);
    });
  });

  // ── GET /api/v1/metrics ────────────────────────────────────────────────────

  describe('GET /api/v1/metrics', () => {
    it('returns a 200 Prometheus text response', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/metrics')
        .expect(200);

      expect(res.text).toContain('#');
    });
  });

  // ── Correlation ID propagation (invariant) ─────────────────────────────

  describe('Correlation ID', () => {
    it('uses the provided X-Correlation-ID header', async () => {
      const correlationId = 'my-trace-id-12345';
      const res = await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/content/generate`)
        .set('X-Correlation-ID', correlationId)
        .send({ topic: 'Test', contentType: ContentType.BLOG })
        .expect(201);

      const enqueued = testApp.queueService.getEnqueuedJobs();
      expect(enqueued[0].correlationId).toBe(correlationId);
    });

    it('generates a correlation ID when none is provided', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/brands/${brand.id}/content/generate`)
        .send({ topic: 'Test', contentType: ContentType.BLOG })
        .expect(201);

      const enqueued = testApp.queueService.getEnqueuedJobs();
      expect(typeof enqueued[0].correlationId).toBe('string');
      expect(enqueued[0].correlationId.length).toBeGreaterThan(0);
    });
  });
});
