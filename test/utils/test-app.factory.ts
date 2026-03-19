/**
 * Creates a full NestJS application for E2E testing.
 *
 * All external dependencies (LLM providers, Qdrant, Redis/BullMQ, TypeORM) are replaced
 * with deterministic in-memory mocks. The HTTP layer, controllers, and module wiring are real.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AppModule } from '../../src/app.module';
import { BrandEntity } from '../../src/brands/entities/brand.entity';
import { ContentJobEntity } from '../../src/content/entities/content-job.entity';
import { DocumentEntity } from '../../src/rag/entities/document.entity';
import { MemoryEventEntity } from '../../src/memory/entities/memory-event.entity';
import { EvaluationRecordEntity } from '../../src/evaluation/entities/evaluation-record.entity';
import { LLM_PROVIDER_TOKEN } from '../../src/common/interfaces/llm-provider.interface';
import { VECTOR_STORE_TOKEN } from '../../src/common/interfaces/vector-store.interface';
import { QueueService } from '../../src/queue/queue.service';
import { MetricsService } from '../../src/observability/metrics.service';
import { createRepositoryMock } from './repository.mock';
import { createOpenAIProviderMock, createClaudeProviderMock, createGeminiProviderMock } from '../mocks/llm-provider.mock';
import { MockVectorStore } from '../mocks/vector-store.mock';
import { MockQueueService } from '../mocks/queue.mock';

export interface TestApp {
  app: INestApplication;
  brandRepo: ReturnType<typeof createRepositoryMock<BrandEntity>>;
  jobRepo: ReturnType<typeof createRepositoryMock<ContentJobEntity>>;
  docRepo: ReturnType<typeof createRepositoryMock<DocumentEntity>>;
  vectorStore: MockVectorStore;
  queueService: MockQueueService;
}

export async function createTestApp(): Promise<TestApp> {
  const brandRepo = createRepositoryMock<BrandEntity>();
  const jobRepo   = createRepositoryMock<ContentJobEntity>();
  const docRepo   = createRepositoryMock<DocumentEntity>();
  const memRepo   = createRepositoryMock<MemoryEventEntity>();
  const evalRepo  = createRepositoryMock<EvaluationRecordEntity>();
  const vectorStore  = new MockVectorStore();
  const queueService = new MockQueueService();

  // Default stub: any update returns {affected: 1}
  jobRepo.update.mockResolvedValue({ affected: 1 } as never);
  brandRepo.update.mockResolvedValue({ affected: 1 } as never);

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    // ── Repository overrides ────────────────────────────────────────────────
    .overrideProvider(getRepositoryToken(BrandEntity)).useValue(brandRepo)
    .overrideProvider(getRepositoryToken(ContentJobEntity)).useValue(jobRepo)
    .overrideProvider(getRepositoryToken(DocumentEntity)).useValue(docRepo)
    .overrideProvider(getRepositoryToken(MemoryEventEntity)).useValue(memRepo)
    .overrideProvider(getRepositoryToken(EvaluationRecordEntity)).useValue(evalRepo)
    // ── LLM providers ──────────────────────────────────────────────────────
    .overrideProvider(LLM_PROVIDER_TOKEN)
    .useValue([createClaudeProviderMock(), createOpenAIProviderMock(), createGeminiProviderMock()])
    // ── Vector store ────────────────────────────────────────────────────────
    .overrideProvider(VECTOR_STORE_TOKEN).useValue(vectorStore)
    // ── Queue ───────────────────────────────────────────────────────────────
    .overrideProvider(QueueService).useValue(queueService)
    // ── Metrics (no-op to avoid prom-client registration conflicts) ─────────
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

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();

  return { app, brandRepo, jobRepo, docRepo, vectorStore, queueService };
}
