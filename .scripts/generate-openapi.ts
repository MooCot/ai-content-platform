// @ts-nocheck
/**
 * generate-openapi.ts
 *
 * Boots a NestJS application with all external dependencies mocked
 * (Postgres, Qdrant, Redis, LLM providers) and writes the generated
 * OpenAPI spec to public/openapi.json.
 *
 * Run: npx ts-node --project tsconfig.json .scripts/generate-openapi.ts
 */
import { Test } from '@nestjs/testing';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getRepositoryToken, getDataSourceToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { BrandEntity } from '../src/brands/entities/brand.entity';
import { ContentJobEntity } from '../src/content/entities/content-job.entity';
import { DocumentEntity } from '../src/rag/entities/document.entity';
import { MemoryEventEntity } from '../src/memory/entities/memory-event.entity';
import { EvaluationRecordEntity } from '../src/evaluation/entities/evaluation-record.entity';
import { LLM_PROVIDER_TOKEN } from '../src/common/interfaces/llm-provider.interface';
import { VECTOR_STORE_TOKEN } from '../src/common/interfaces/vector-store.interface';
import { QueueService } from '../src/queue/queue.service';
import { ContentPipelineProcessor } from '../src/queue/processors/content-pipeline.processor';
import { MetricsService } from '../src/observability/metrics.service';
import { CONTENT_PIPELINE_QUEUE } from '../src/queue/queue.constants';

// ── Plain-object mocks (no Jest runtime needed) ───────────────────────────────

const noop = () => Promise.resolve(undefined);

const repoMock = {
  find: () => Promise.resolve([]),
  findOne: () => Promise.resolve(null),
  save: (e: unknown) => Promise.resolve(e),
  create: (d: unknown) => d,
  update: () => Promise.resolve({ affected: 1 }),
  delete: () => Promise.resolve({ affected: 1 }),
  count: () => Promise.resolve(0),
  findAndCount: () => Promise.resolve([[], 0]),
};

const dataSourceMock = {
  isInitialized: true,
  destroy: noop,
  query: () => Promise.resolve([{ '?column?': 1 }]),
  manager: { transaction: noop, find: noop, findOne: noop },
  getRepository: () => repoMock,
} as unknown as DataSource;

const llmProviderMock = {
  provider: 'openai',
  supportedModels: ['gpt-4o'],
  complete: () => Promise.resolve({ content: '', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'gpt-4o', provider: 'openai' }),
  stream: () => { throw new Error('not needed'); },
  embed: () => Promise.resolve([[]]),
  isAvailable: () => Promise.resolve(true),
};

const vectorStoreMock = {
  upsert: noop,
  search: () => Promise.resolve([]),
  delete: noop,
  createCollection: noop,
  deleteCollection: noop,
  collectionExists: () => Promise.resolve(false),
};

const queueServiceMock = {
  enqueue: () => Promise.resolve('mock-job-id'),
  getDepth: () => Promise.resolve(0),
};

const metricsMock = {
  recordTokenUsage: noop,
  recordLlmLatency: noop,
  recordLlmError: noop,
  recordPipelineLatency: noop,
  recordAgentLatency: noop,
  setQueueDepth: noop,
  recordQueueWaitTime: noop,
  recordEvaluationScore: noop,
  recordDegradation: noop,
  getMetrics: () => Promise.resolve('# mock'),
};

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(getRepositoryToken(BrandEntity)).useValue(repoMock)
    .overrideProvider(getRepositoryToken(ContentJobEntity)).useValue(repoMock)
    .overrideProvider(getRepositoryToken(DocumentEntity)).useValue(repoMock)
    .overrideProvider(getRepositoryToken(MemoryEventEntity)).useValue(repoMock)
    .overrideProvider(getRepositoryToken(EvaluationRecordEntity)).useValue(repoMock)
    .overrideProvider(LLM_PROVIDER_TOKEN).useValue([llmProviderMock])
    .overrideProvider(VECTOR_STORE_TOKEN).useValue(vectorStoreMock)
    .overrideProvider(getDataSourceToken()).useValue(dataSourceMock)
    .overrideProvider(QueueService).useValue(queueServiceMock)
    .overrideProvider(getQueueToken(CONTENT_PIPELINE_QUEUE)).useValue({
      add: () => Promise.resolve({ id: 'mock' }),
      getJobCounts: () => Promise.resolve({ waiting: 0, active: 0 }),
      obliterate: noop,
    })
    .overrideProvider(ContentPipelineProcessor).useValue({})
    .overrideProvider(MetricsService).useValue(metricsMock)
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Multi-Brand AI Content Platform')
    .setDescription(
      'Production-grade AI content generation with multi-tenant RAG, ' +
      'agent pipelines (Planner → Researcher → Generator → Optimizer → QA), ' +
      'multi-LLM routing (Claude / OpenAI / Gemini), circuit breakers, ' +
      'and real-time SSE streaming.',
    )
    .setVersion('1.0')
    .setContact('Slava Ur', 'https://github.com/MooCot/ai-content-platform', '')
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addTag('brands', 'Brand management and configuration')
    .addTag('rag', 'Document ingestion and semantic search')
    .addTag('content', 'AI content generation jobs')
    .addTag('streaming', 'Server-Sent Events real-time output')
    .addTag('evaluation', 'LLM quality scoring and model comparison')
    .addTag('health', 'Liveness and readiness probes')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  const outDir = join(process.cwd(), 'public');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'openapi.json');
  writeFileSync(outPath, JSON.stringify(document, null, 2));

  console.log(`OpenAPI spec written to ${outPath}`);
  console.log(`  Paths: ${Object.keys(document.paths).length}`);
  console.log(`  Schemas: ${Object.keys(document.components?.schemas ?? {}).length}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
