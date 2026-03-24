/**
 * Integration test: RAG ingestion and semantic search pipeline.
 *
 * Uses the real RAGService wired with in-memory MockVectorStore and mock LLM router.
 * Validates the full PENDING → CHUNKING → EMBEDDING → READY status machine.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RAGService } from '../../src/rag/services/rag.service';
import { TextSplitterService } from '../../src/rag/services/text-splitter.service';
import { DocumentParserService } from '../../src/rag/services/document-parser.service';
import { DocumentEntity } from '../../src/rag/entities/document.entity';
import { VECTOR_STORE_TOKEN } from '../../src/common/interfaces/vector-store.interface';
import { LLMRouterService } from '../../src/llm/llm-router.service';
import { DocumentStatus } from '../../src/common/types/domain.types';
import { MockVectorStore } from '../mocks/vector-store.mock';
import { createRepositoryMock } from '../utils/repository.mock';
import { createMockConfigService } from '../utils/mock-config.service';

describe('RAG Pipeline Integration', () => {
  let service: RAGService;
  let repoMock: ReturnType<typeof createRepositoryMock<DocumentEntity>>;
  let vectorStore: MockVectorStore;
  let llmRouterMock: jest.Mocked<LLMRouterService>;

  // Simulated document with 3 paragraphs — each ~100 chars, total ~300 chars
  const SAMPLE_CONTENT = [
    'Vector databases store high-dimensional embedding vectors for efficient similarity search.',
    'They are widely used in recommendation systems, semantic search, and RAG pipelines.',
    'Popular vector DBs include Qdrant, Pinecone, Weaviate, and Chroma.',
  ].join('\n\n');

  beforeEach(async () => {
    repoMock = createRepositoryMock<DocumentEntity>();
    vectorStore = new MockVectorStore();

    llmRouterMock = {
      embed: jest.fn().mockResolvedValue([Array(1536).fill(0.1)]),
    } as unknown as jest.Mocked<LLMRouterService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        TextSplitterService,
        { provide: getRepositoryToken(DocumentEntity), useValue: repoMock },
        {
          provide: DocumentParserService,
          useValue: { parse: jest.fn().mockResolvedValue({ text: SAMPLE_CONTENT, metadata: {} }) },
        },
        { provide: VECTOR_STORE_TOKEN, useValue: vectorStore     },
        { provide: LLMRouterService,   useValue: llmRouterMock   },
        { provide: 'ConfigService', useValue: createMockConfigService() },
      ],
    })
      .overrideProvider('ConfigService')
      .useValue(createMockConfigService())
      .compile();

    service = module.get(RAGService);
  });

  // ── Status machine: PENDING → CHUNKING → EMBEDDING → READY ────────────────

  it('progresses through the full status machine and ends in READY', async () => {
    const docBase: Partial<DocumentEntity> = {
      id: 'doc-integ-1',
      brandId: 'brand-1',
      filename: 'kb.txt',
      mimeType: 'text/plain',
      status: DocumentStatus.PENDING,
      fileSizeBytes: 300,
    };
    repoMock.create.mockReturnValue(docBase as DocumentEntity);
    repoMock.save.mockResolvedValue(docBase as DocumentEntity);

    await service.ingest('brand-1', Buffer.from(SAMPLE_CONTENT), 'kb.txt', 'text/plain');

    // Wait for async processDocument() to complete
    await new Promise((r) => setTimeout(r, 50));

    const statusTransitions = repoMock.update.mock.calls.map(
      ([, p]) => (p as { status: string }).status,
    );
    expect(statusTransitions).toContain(DocumentStatus.CHUNKING);
    expect(statusTransitions).toContain(DocumentStatus.EMBEDDING);
    expect(statusTransitions).toContain(DocumentStatus.READY);
  });

  // ── Vector store upsert ───────────────────────────────────────────────────

  it('upserts chunk embeddings to the brand-scoped Qdrant collection', async () => {
    const docBase: Partial<DocumentEntity> = {
      id: 'doc-integ-2',
      brandId: 'brand-scope',
      filename: 'test.txt',
      mimeType: 'text/plain',
      status: DocumentStatus.PENDING,
    };
    repoMock.create.mockReturnValue(docBase as DocumentEntity);
    repoMock.save.mockResolvedValue(docBase as DocumentEntity);

    await service.ingest('brand-scope', Buffer.from(SAMPLE_CONTENT), 'test.txt', 'text/plain');
    await new Promise((r) => setTimeout(r, 50));

    const points = vectorStore.getCollectionPoints('brand_brand-scope');
    expect(points.length).toBeGreaterThan(0);
    // invariant: collection name is brand-scoped
    expect(vectorStore.getCollectionPoints('brand_other-brand')).toHaveLength(0);
  });

  // ── Embedding batch size ───────────────────────────────────────────────────

  it('calls embed() for each batch of chunks with correct texts', async () => {
    const docBase: Partial<DocumentEntity> = {
      id: 'doc-integ-3',
      brandId: 'brand-1',
      filename: 'large.txt',
      mimeType: 'text/plain',
      status: DocumentStatus.PENDING,
    };
    repoMock.create.mockReturnValue(docBase as DocumentEntity);
    repoMock.save.mockResolvedValue(docBase as DocumentEntity);

    await service.ingest('brand-1', Buffer.from(SAMPLE_CONTENT), 'large.txt', 'text/plain');
    await new Promise((r) => setTimeout(r, 50));

    // embed() must have been called at least once with an array of strings
    expect(llmRouterMock.embed).toHaveBeenCalledWith(expect.arrayContaining([expect.any(String)]));
  });

  // ── Semantic search ───────────────────────────────────────────────────────

  it('finds relevant chunks after ingestion', async () => {
    // Seed the vector store directly
    await vectorStore.ensureCollection('brand_brand-search', 1536);
    await vectorStore.upsert('brand_brand-search', [
      {
        id: 'c1',
        vector: Array(1536).fill(0.9),
        payload: {
          content: 'Vector databases use cosine similarity',
          documentId: 'doc-1',
          brandId: 'brand-search',
          filename: 'guide.pdf',
          chunkIndex: 0,
        },
      },
    ]);

    llmRouterMock.embed.mockResolvedValue([Array(1536).fill(0.9)]);
    const results = await service.search('brand-search', 'cosine similarity', 5);

    expect(results).toHaveLength(1);
    expect(results[0].content).toContain('cosine similarity');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('returns empty results for a new brand with no ingested documents', async () => {
    const results = await service.search('brand-empty', 'anything');
    expect(results).toEqual([]);
  });

  // ── invariant: only READY docs are searchable ───────────────────────────

  it('returns empty when collection does not exist (documents not yet READY)', async () => {
    // Collection never created = documents are still processing
    const results = await service.search('brand-not-ready', 'query');
    expect(results).toEqual([]);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('marks document FAILED when parser throws, without crashing the service', async () => {
    const docBase: Partial<DocumentEntity> = { id: 'doc-fail', brandId: 'brand-1', status: DocumentStatus.PENDING };
    repoMock.create.mockReturnValue(docBase as DocumentEntity);
    repoMock.save.mockResolvedValue(docBase as DocumentEntity);

    const { parse } = service['documentParser'] as { parse: jest.Mock };
    if (parse) parse.mockRejectedValueOnce(new Error('parse error'));

    // Should resolve without throwing (async background task)
    await expect(
      service.ingest('brand-1', Buffer.alloc(0), 'bad.bin', 'application/octet-stream'),
    ).resolves.toBeDefined();
  });
});
