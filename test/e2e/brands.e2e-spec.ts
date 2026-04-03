import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp, TestApp } from '../utils/test-app.factory';
import { createBrandFixture } from '../fixtures/brand.fixture';
import { BrandEntity } from '../../src/brands/entities/brand.entity';
import { LLMProvider, Tone } from '../../src/common/types/domain.types';

describe('Brands E2E (/api/v1/brands)', () => {
  let testApp: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    testApp.brandRepo.find.mockResolvedValue([]);
    testApp.brandRepo.findOne.mockResolvedValue(null);
    testApp.brandRepo.save.mockImplementation((e: Partial<BrandEntity>) => Promise.resolve({ id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', ...e } as unknown as BrandEntity));
    testApp.brandRepo.create.mockImplementation((dto: Partial<BrandEntity>) => ({ id: 'f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', isActive: true, createdAt: new Date(), updatedAt: new Date(), slug: '', name: '', ...dto } as unknown as BrandEntity));
  });

  // ── POST /brands ───────────────────────────────────────────────────────────

  describe('POST /api/v1/brands', () => {
    const validPayload = {
      slug: 'test-brand',
      name: 'Test Brand',
      config: {
        defaultTone: Tone.TECHNICAL,
        allowedModels: ['claude-sonnet-4-6'],
        preferredProvider: LLMProvider.CLAUDE,
        ragEnabled: true,
        systemPrompt: 'You are a technical writer.',
        maxContentLength: 2000,
      },
    };

    it('creates a brand and returns 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/brands')
        .send(validPayload)
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.slug).toBe('test-brand');
    });

    it('returns 400 when slug is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/brands')
        .send({ name: 'No Slug' })
        .expect(400);
    });

    it('returns 400 when config is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/brands')
        .send({ slug: 'x', name: 'X' })
        .expect(400);
    });
  });

  // ── GET /brands ────────────────────────────────────────────────────────────

  describe('GET /api/v1/brands', () => {
    it('returns an array of brands', async () => {
      const brand = createBrandFixture();
      testApp.brandRepo.find.mockResolvedValue([brand]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/brands')
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(brand.id);
    });
  });

  // ── GET /brands/:id ────────────────────────────────────────────────────────

  describe('GET /api/v1/brands/:id', () => {
    it('returns 200 with the brand when found', async () => {
      const brand = createBrandFixture();
      testApp.brandRepo.findOne.mockResolvedValue(brand);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/brands/${brand.id}`)
        .expect(200);

      expect(res.body.id).toBe(brand.id);
    });

    it('returns 404 when brand does not exist', async () => {
      testApp.brandRepo.findOne.mockResolvedValue(null);
      await request(app.getHttpServer())
        .get('/api/v1/brands/c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13')
        .expect(404);
    });
  });

  // ── PATCH /brands/:id/config ───────────────────────────────────────────────

  describe('PATCH /api/v1/brands/:id/config', () => {
    it('updates brand config and returns 200', async () => {
      const brand = createBrandFixture();
      testApp.brandRepo.findOne.mockResolvedValue(brand);
      testApp.brandRepo.save.mockResolvedValue({ ...brand, config: { ...brand.config, maxContentLength: 5000 } });

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/brands/${brand.id}/config`)
        .send({
          config: {
            defaultTone: Tone.TECHNICAL,
            allowedModels: ['claude-sonnet-4-6'],
            preferredProvider: LLMProvider.CLAUDE,
            maxContentLength: 5000,
          },
        })
        .expect(200);

      expect(res.body.config.maxContentLength).toBe(5000);
    });

    it('returns 404 when brand does not exist', async () => {
      testApp.brandRepo.findOne.mockResolvedValue(null);
      await request(app.getHttpServer())
        .patch('/api/v1/brands/c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13/config')
        .send({
          config: {
            defaultTone: Tone.TECHNICAL,
            allowedModels: ['claude-sonnet-4-6'],
            preferredProvider: LLMProvider.CLAUDE,
            maxContentLength: 1000,
          },
        })
        .expect(404);
    });
  });

  // ── DELETE /brands/:id ────────────────────────────────────────────────────

  describe('DELETE /api/v1/brands/:id', () => {
    it('deactivates a brand and returns 204', async () => {
      const brand = createBrandFixture();
      testApp.brandRepo.findOne.mockResolvedValue(brand);
      testApp.brandRepo.save.mockResolvedValue({ ...brand, isActive: false });

      await request(app.getHttpServer())
        .delete(`/api/v1/brands/${brand.id}`)
        .expect(204);
    });
  });
});
