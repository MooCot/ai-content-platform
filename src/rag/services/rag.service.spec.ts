import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RAGService } from './rag.service';
import { DocumentEntity } from '../entities/document.entity';
import { TextSplitterService } from './text-splitter.service';
import { DocumentParserService } from './document-parser.service';
import { VECTOR_STORE_TOKEN } from '../../common/interfaces/vector-store.interface';
import { LLMRouterService } from '../../llm/llm-router.service';
import { DocumentStatus } from '../../common/types/domain.types';
import { DocumentNotFoundException } from '../../common/exceptions/domain.exceptions';
import { MockVectorStore } from '../../../test/mocks/vector-store.mock';
import { createRepositoryMock } from '../../../test/utils/repository.mock';
import { ConfigService } from '@nestjs/config';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

describe('RAGService', () => {
  let service: RAGService;
  let repoMock: ReturnType<typeof createRepositoryMock<DocumentEntity>>;
  let vectorStore: MockVectorStore;
  let llmRouterMock: jest.Mocked<LLMRouterService>;
  let textSplitterMock: jest.Mocked<TextSplitterService>;
  let documentParserMock: jest.Mocked<DocumentParserService>;

  beforeEach(async () => {
    repoMock = createRepositoryMock<DocumentEntity>();
    vectorStore = new MockVectorStore();
    llmRouterMock = {
      embed: jest.fn().mockResolvedValue([Array(1536).fill(0.1)]),
    } as unknown as jest.Mocked<LLMRouterService>;
    textSplitterMock = {
      split: jest.fn().mockReturnValue(['chunk 1', 'chunk 2', 'chunk 3']),
    } as unknown as jest.Mocked<TextSplitterService>;
    documentParserMock = {
      parse: jest.fn().mockResolvedValue({ text: 'parsed document text', metadata: {} }),
    } as unknown as jest.Mocked<DocumentParserService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RAGService,
        { provide: getRepositoryToken(DocumentEntity), useValue: repoMock },
        { provide: TextSplitterService, useValue: textSplitterMock },
        { provide: DocumentParserService, useValue: documentParserMock },
        { provide: VECTOR_STORE_TOKEN, useValue: vectorStore },
        { provide: LLMRouterService, useValue: llmRouterMock },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(createMockConfigService())
      .compile();

    service = module.get(RAGService);
  });

  // ── ingest() ──────────────────────────────────────────────────────────────

  describe('ingest()', () => {
    it('creates a PENDING document entity immediately and returns it', async () => {
      const doc = { id: 'doc-1', status: DocumentStatus.PENDING } as DocumentEntity;
      repoMock.create.mockReturnValue(doc);
      repoMock.save.mockResolvedValue(doc);

      const result = await service.ingest(
        'brand-1',
        Buffer.from('hello'),
        'test.txt',
        'text/plain',
      );

      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: DocumentStatus.PENDING }),
      );
      expect(result.status).toBe(DocumentStatus.PENDING);
    });

    it('processes the document asynchronously through CHUNKING → EMBEDDING → READY', async () => {
      const doc: Partial<DocumentEntity> = {
        id: 'doc-1',
        brandId: 'brand-1',
        filename: 'test.txt',
        mimeType: 'text/plain',
        status: DocumentStatus.PENDING,
        fileSizeBytes: 100,
      };
      repoMock.create.mockReturnValue(doc as DocumentEntity);
      repoMock.save.mockResolvedValue(doc as DocumentEntity);

      await service.ingest('brand-1', Buffer.from('hello'), 'test.txt', 'text/plain');

      // Allow the async processDocument() to run
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const updateCalls = (
        repoMock.update.mock.calls as unknown as Array<[string, { status: string }]>
      ).map(([, patch]) => patch.status);
      expect(updateCalls).toContain(DocumentStatus.CHUNKING);
      expect(updateCalls).toContain(DocumentStatus.EMBEDDING);
      expect(updateCalls).toContain(DocumentStatus.READY);
    });

    it('marks document FAILED when parsing throws', async () => {
      documentParserMock.parse.mockRejectedValue(new Error('unsupported format'));
      const doc: Partial<DocumentEntity> = {
        id: 'doc-1',
        brandId: 'brand-1',
        filename: 'bad.bin',
        mimeType: 'application/octet-stream',
        status: DocumentStatus.PENDING,
      };
      repoMock.create.mockReturnValue(doc as DocumentEntity);
      repoMock.save.mockResolvedValue(doc as DocumentEntity);

      await service.ingest('brand-1', Buffer.from(''), 'bad.bin', 'application/octet-stream');
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const failCall = (
        repoMock.update.mock.calls as unknown as Array<[string, { status: string }]>
      ).find(([, patch]) => patch.status === DocumentStatus.FAILED);
      expect(failCall).toBeDefined();
    });
  });

  // ── search() ──────────────────────────────────────────────────────────────

  describe('search()', () => {
    it('returns empty array when the collection does not exist (κ-invariant: brand isolation)', async () => {
      const results = await service.search('brand-new', 'query');
      expect(results).toEqual([]);
    });

    it('embeds the query and searches the brand-scoped collection', async () => {
      await vectorStore.ensureCollection('brand_brand-1', 1536);
      await vectorStore.upsert('brand_brand-1', [
        {
          id: 'c1',
          vector: Array(1536).fill(0.1),
          payload: {
            content: 'vec db',
            documentId: 'd1',
            brandId: 'brand-1',
            filename: 'f.txt',
            chunkIndex: 0,
          },
        },
      ]);

      const results = await service.search('brand-1', 'vec db', 5);
      expect(llmRouterMock.embed).toHaveBeenCalledWith(['vec db']);
      expect(Array.isArray(results)).toBe(true);
    });

    it('uses the brand-scoped collection name (κ-invariant: brand isolation)', () => {
      expect(service.collectionName('brand-abc')).toBe('brand_brand-abc');
    });
  });

  // ── listDocuments() / getDocument() ──────────────────────────────────────

  describe('listDocuments()', () => {
    it('filters by brandId', async () => {
      repoMock.find.mockResolvedValue([]);
      await service.listDocuments('brand-1');
      expect(repoMock.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { brandId: 'brand-1' } }),
      );
    });
  });

  describe('getDocument()', () => {
    it('throws DocumentNotFoundException when document not found', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await expect(service.getDocument('doc-x', 'brand-1')).rejects.toThrow(
        DocumentNotFoundException,
      );
    });

    it('scopes lookup by both docId and brandId (κ-invariant: brand isolation)', async () => {
      repoMock.findOne.mockResolvedValue(null);
      await service.getDocument('doc-1', 'brand-1').catch(() => {});
      expect(repoMock.findOne).toHaveBeenCalledWith({
        where: { id: 'doc-1', brandId: 'brand-1' },
      });
    });
  });
});
