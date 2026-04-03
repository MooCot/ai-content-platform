/**
 * E2E tests for SSE streaming, RAG document upload, and evaluation endpoints.
 *
 * Uses the full NestJS app (createTestApp) with all external dependencies mocked.
 * StreamingService is overridden with a minimal mock that closes the SSE connection
 * immediately so supertest can read the response headers without hanging.
 */
import * as request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { BrandEntity } from '../../src/brands/entities/brand.entity';
import { ContentJobEntity } from '../../src/content/entities/content-job.entity';
import { DocumentEntity } from '../../src/rag/entities/document.entity';
import { MemoryEventEntity } from '../../src/memory/entities/memory-event.entity';
import { EvaluationRecordEntity } from '../../src/evaluation/entities/evaluation-record.entity';
import { LLM_PROVIDER_TOKEN } from '../../src/common/interfaces/llm-provider.interface';
import { VECTOR_STORE_TOKEN } from '../../src/common/interfaces/vector-store.interface';
import { QueueService } from '../../src/queue/queue.service';
import { ContentPipelineProcessor } from '../../src/queue/processors/content-pipeline.processor';
import { StreamingService } from '../../src/streaming/streaming.service';
import { MetricsService } from '../../src/observability/metrics.service';
import { CONTENT_PIPELINE_QUEUE } from '../../src/queue/queue.constants';
import { DocumentStatus } from '../../src/common/types/domain.types';
import { createRepositoryMock } from '../utils/repository.mock';
import { createTestApp, TestApp } from '../utils/test-app.factory';
import {
  createOpenAIProviderMock,
  createClaudeProviderMock,
  createGeminiProviderMock,
} from '../mocks/llm-provider.mock';
import { MockVectorStore } from '../mocks/vector-store.mock';
import { MockQueueService } from '../mocks/queue.mock';
import { createBrandFixture } from '../fixtures/brand.fixture';
import { Response } from 'express';

// ── SSE Streaming (GET /api/v1/stream/:jobId) ──────────────────────────────

describe('GET /api/v1/stream/:jobId — SSE endpoint', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Build a test app that overrides StreamingService with a mock that
    // immediately closes the response after setting SSE headers.
    // This lets supertest capture the response headers without blocking.
    const streamingMock = {
      isActive: jest.fn().mockReturnValue(false),
      register: jest.fn().mockImplementation((_jobId: string, res: Response) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.end();
      }),
      cancel: jest.fn(),
      emit: jest.fn(),
      close: jest.fn(),
    };

    const brandRepo   = createRepositoryMock<BrandEntity>();
    const jobRepo     = createRepositoryMock<ContentJobEntity>();
    const docRepo     = createRepositoryMock<DocumentEntity>();
    const memRepo     = createRepositoryMock<MemoryEventEntity>();
    const evalRepo    = createRepositoryMock<EvaluationRecordEntity>();
    const vectorStore = new MockVectorStore();
    const queueService = new MockQueueService();

    jobRepo.update.mockResolvedValue({ affected: 1 } as never);
    brandRepo.update.mockResolvedValue({ affected: 1 } as never);

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getRepositoryToken(BrandEntity)).useValue(brandRepo)
      .overrideProvider(getRepositoryToken(ContentJobEntity)).useValue(jobRepo)
      .overrideProvider(getRepositoryToken(DocumentEntity)).useValue(docRepo)
      .overrideProvider(getRepositoryToken(MemoryEventEntity)).useValue(memRepo)
      .overrideProvider(getRepositoryToken(EvaluationRecordEntity)).useValue(evalRepo)
      .overrideProvider(LLM_PROVIDER_TOKEN)
        .useValue([createClaudeProviderMock(), createOpenAIProviderMock(), createGeminiProviderMock()])
      .overrideProvider(VECTOR_STORE_TOKEN).useValue(vectorStore)
      .overrideProvider(QueueService).useValue(queueService)
      .overrideProvider(getDataSourceToken())
      .useValue({
        isInitialized: true,
        destroy: jest.fn().mockResolvedValue(undefined),
        manager: { transaction: jest.fn(), find: jest.fn(), findOne: jest.fn() },
        getRepository: jest.fn().mockReturnValue({}),
      } as unknown as DataSource)
      .overrideProvider(getQueueToken(CONTENT_PIPELINE_QUEUE)).useValue({
        add: jest.fn().mockResolvedValue({ id: 'mock-bull-job' }),
        getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0 }),
        obliterate: jest.fn().mockResolvedValue(undefined),
      })
      .overrideProvider(ContentPipelineProcessor).useValue({})
      .overrideProvider(StreamingService).useValue(streamingMock)
      .overrideProvider(MetricsService).useValue({
        recordTokenUsage: jest.fn(),
        recordLlmLatency: jest.fn(),
        recordLlmError: jest.fn(),
        recordPipelineLatency: jest.fn(),
        recordAgentLatency: jest.fn(),
        setQueueDepth: jest.fn(),
        recordQueueWaitTime: jest.fn(),
        recordEvaluationScore: jest.fn(),
        getMetrics: jest.fn().mockResolvedValue('# prometheus mock'),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(() => app.close());

  it('returns 200 with text/event-stream content-type', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/stream/test-job-sse-001')
      .expect(200);

    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('returns cache-control: no-cache header', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/stream/test-job-sse-002')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('calls StreamingService.register with the provided jobId', async () => {
    const streamingService = app.get(StreamingService);
    (streamingService.register as jest.Mock).mockClear();

    await request(app.getHttpServer())
      .get('/api/v1/stream/my-custom-job-id')
      .expect(200);

    expect(streamingService.register).toHaveBeenCalledWith(
      'my-custom-job-id',
      expect.anything(),
    );
  });

  it('DELETE /api/v1/stream/:jobId calls cancel and returns 204', async () => {
    const streamingService = app.get(StreamingService);
    (streamingService.cancel as jest.Mock).mockClear();

    await request(app.getHttpServer())
      .delete('/api/v1/stream/cancel-job-id')
      .expect(204);

    expect(streamingService.cancel).toHaveBeenCalledWith('cancel-job-id');
  });
});

// ── RAG Document Upload (POST /api/v1/brands/:brandId/rag/upload) ──────────

describe('POST /api/v1/brands/:brandId/rag/upload — document ingest', () => {
  let testApp: TestApp;
  let app: INestApplication;
  const brand = createBrandFixture();

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(() => app.close());

  beforeEach(() => {
    testApp.brandRepo.findOne.mockResolvedValue(brand);

    const doc: Partial<DocumentEntity> = {
      id: 'doc-upload-uuid',
      brandId: brand.id,
      filename: 'knowledge-base.txt',
      mimeType: 'text/plain',
      status: DocumentStatus.PENDING,
      chunkCount: 0,
      errorMessage: null,
      fileSizeBytes: 42,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    };
    testApp.docRepo.create.mockReturnValue(doc as DocumentEntity);
    testApp.docRepo.save.mockResolvedValue(doc as DocumentEntity);
    testApp.docRepo.update.mockResolvedValue({ affected: 1 } as never);
  });

  it('returns 201 with document id, filename, status, and message', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/brands/${brand.id}/rag/upload`)
      .attach('file', Buffer.from('Vector databases are fast.'), 'knowledge-base.txt')
      .expect(201);

    expect(res.body).toHaveProperty('id', 'doc-upload-uuid');
    expect(res.body).toHaveProperty('filename', 'knowledge-base.txt');
    expect(res.body).toHaveProperty('status', DocumentStatus.PENDING);
    expect(res.body).toHaveProperty('message');
  });

  it('returns 400 when brandId is not a valid UUID', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/brands/not-a-uuid/rag/upload')
      .attach('file', Buffer.from('data'), 'file.txt')
      .expect(400);
  });

  it('document is accepted for async processing (non-blocking response)', async () => {
    const start = Date.now();
    await request(app.getHttpServer())
      .post(`/api/v1/brands/${brand.id}/rag/upload`)
      .attach('file', Buffer.from('Content to process.'), 'async-test.txt')
      .expect(201);

    // Response should come back well before any realistic processing time
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

// ── GET /api/v1/brands/:brandId/rag/documents ──────────────────────────────

describe('GET /api/v1/brands/:brandId/rag/documents — list documents', () => {
  let testApp: TestApp;
  let app: INestApplication;
  const brand = createBrandFixture();

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(() => app.close());

  beforeEach(() => {
    testApp.brandRepo.findOne.mockResolvedValue(brand);
  });

  it('returns an array of documents for the brand', async () => {
    const docs: Partial<DocumentEntity>[] = [
      { id: 'doc-1', brandId: brand.id, filename: 'a.txt', status: DocumentStatus.READY, mimeType: 'text/plain', chunkCount: 3, errorMessage: null, fileSizeBytes: 100, createdAt: new Date(), updatedAt: new Date() },
    ];
    testApp.docRepo.find.mockResolvedValue(docs as DocumentEntity[]);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/brands/${brand.id}/rag/documents`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('doc-1');
    expect(res.body[0].status).toBe(DocumentStatus.READY);
  });

  it('returns empty array when brand has no documents', async () => {
    testApp.docRepo.find.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/brands/${brand.id}/rag/documents`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });
});

// ── GET /api/v1/brands/:brandId/evaluations ────────────────────────────────

describe('GET /api/v1/brands/:brandId/evaluations — evaluation records', () => {
  let testApp: TestApp;
  let app: INestApplication;
  const brand = createBrandFixture();

  beforeAll(async () => {
    testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(() => app.close());

  beforeEach(() => {
    testApp.brandRepo.findOne.mockResolvedValue(brand);
  });

  it('returns an array of evaluation records for the brand', async () => {
    const records: Partial<EvaluationRecordEntity>[] = [
      {
        id: 'eval-1',
        jobId: 'job-1',
        brandId: brand.id,
        contentType: 'BLOG',
        modelId: 'claude-3-5-sonnet',
        promptVersion: '1.0.0',
        relevanceScore: 0.85,
        toneScore: 0.80,
        factualityScore: 0.90,
        readabilityScore: 0.75,
        compositeScore: 0.82,
        dimensions: {} as never,
        evaluatedAt: new Date('2024-01-01'),
      },
    ];
    testApp.evalRepo.find.mockResolvedValue(records as EvaluationRecordEntity[]);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/brands/${brand.id}/evaluations`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].id).toBe('eval-1');
    expect(res.body[0].compositeScore).toBe(0.82);
  });

  it('returns empty array when no evaluations exist for the brand', async () => {
    testApp.evalRepo.find.mockResolvedValue([]);

    const res = await request(app.getHttpServer())
      .get(`/api/v1/brands/${brand.id}/evaluations`)
      .expect(200);

    expect(res.body).toHaveLength(0);
  });

  it('respects the limit query parameter (default 50)', async () => {
    testApp.evalRepo.find.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get(`/api/v1/brands/${brand.id}/evaluations?limit=10`)
      .expect(200);

    expect(testApp.evalRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      }),
    );
  });

  it('caps limit at 200 regardless of query parameter', async () => {
    testApp.evalRepo.find.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get(`/api/v1/brands/${brand.id}/evaluations?limit=999`)
      .expect(200);

    expect(testApp.evalRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 200,
      }),
    );
  });

  it('returns 400 when brandId is not a valid UUID', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/brands/not-a-uuid/evaluations')
      .expect(400);
  });
});
