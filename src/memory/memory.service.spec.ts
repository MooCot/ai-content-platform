import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MemoryService } from './memory.service';
import { MemoryEventEntity } from './entities/memory-event.entity';
import { LLMRouterService } from '../llm/llm-router.service';
import { AgentRole } from '../common/types/domain.types';
import { createRepositoryMock } from '../../test/utils/repository.mock';
import { createMockConfigService } from '../../test/utils/mock-config.service';

// Qdrant client is instantiated inside the constructor — mock the whole module.
jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollections: jest.fn().mockResolvedValue({ collections: [] }),
    search: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue({}),
    createCollection: jest.fn().mockResolvedValue({}),
    createPayloadIndex: jest.fn().mockResolvedValue({}),
  })),
}));

describe('MemoryService', () => {
  let service: MemoryService;
  let repoMock: ReturnType<typeof createRepositoryMock<MemoryEventEntity>>;
  let llmRouterMock: jest.Mocked<LLMRouterService>;

  beforeEach(async () => {
    repoMock = createRepositoryMock<MemoryEventEntity>();
    llmRouterMock = {
      embed: jest.fn().mockResolvedValue([Array(1536).fill(0.1)]),
    } as unknown as jest.Mocked<LLMRouterService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MemoryService,
        { provide: getRepositoryToken(MemoryEventEntity), useValue: repoMock },
        { provide: LLMRouterService, useValue: llmRouterMock },
        { provide: 'ConfigService', useValue: createMockConfigService() },
      ],
    })
      .overrideProvider('ConfigService')
      .useValue(createMockConfigService())
      .compile();

    service = module.get(MemoryService);
  });

  // ── record() ──────────────────────────────────────────────────────────────

  describe('record()', () => {
    const params = {
      brandId: 'brand-1',
      jobId: 'job-1',
      agent: AgentRole.QA,
      eventType: 'generation_complete',
      content: 'Final content here',
      payload: { compositeScore: 0.85 },
    };

    it('persists to Postgres and returns the saved entity', async () => {
      const savedEntity = { id: 'evt-1', ...params, qdrantIndexed: false };
      repoMock.save.mockResolvedValue(savedEntity as unknown as MemoryEventEntity);
      repoMock.create.mockReturnValue(savedEntity as unknown as MemoryEventEntity);

      const result = await service.record(params);

      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ brandId: 'brand-1', qdrantIndexed: false }),
      );
      expect(repoMock.save).toHaveBeenCalled();
      expect(result).toBe(savedEntity);
    });

    it('defaults promptVersion to "0.0.0" when not provided', async () => {
      const saved = { id: 'evt-2', promptVersion: '0.0.0' };
      repoMock.create.mockReturnValue(saved as unknown as MemoryEventEntity);
      repoMock.save.mockResolvedValue(saved as unknown as MemoryEventEntity);

      await service.record(params);
      expect(repoMock.create).toHaveBeenCalledWith(
        expect.objectContaining({ promptVersion: '0.0.0' }),
      );
    });
  });

  // ── queryRelevant() ───────────────────────────────────────────────────────

  describe('queryRelevant()', () => {
    it('returns empty array when the memory collection does not exist', async () => {
      // QdrantClient.getCollections returns [] — collection not found
      const results = await service.queryRelevant('brand-1', 'some topic');
      expect(results).toEqual([]);
    });

    it('returns empty array when embedding fails', async () => {
      // Make collection "exist"
      const qdrant = (
        service as unknown as { qdrant: { getCollections: jest.Mock; search: jest.Mock } }
      ).qdrant;
      qdrant.getCollections.mockResolvedValue({
        collections: [{ name: 'brand_brand-1_memory' }],
      });
      llmRouterMock.embed.mockRejectedValue(new Error('embed failed'));

      const results = await service.queryRelevant('brand-1', 'topic');
      expect(results).toEqual([]);
    });
  });

  // ── embedAndIndex() ───────────────────────────────────────────────────────

  describe('embedAndIndex()', () => {
    it('embeds content and upserts to Qdrant, then marks entity as indexed', async () => {
      const mockEvent = {
        id: 'evt-1',
        brandId: 'brand-1',
        agent: AgentRole.QA,
        eventType: 'generation_complete',
        content: 'hello',
        payload: {},
        createdAt: new Date(),
      };
      repoMock.findOne.mockResolvedValue(mockEvent as unknown as MemoryEventEntity);

      const qdrant = (
        service as unknown as {
          qdrant: {
            getCollections: jest.Mock;
            createCollection: jest.Mock;
            createPayloadIndex: jest.Mock;
            upsert: jest.Mock;
          };
        }
      ).qdrant;
      qdrant.getCollections.mockResolvedValue({ collections: [{ name: 'brand_brand-1_memory' }] });

      await service.embedAndIndex('evt-1', 'hello world', 'brand-1');

      expect(llmRouterMock.embed).toHaveBeenCalledWith(['hello world']);
      expect(qdrant.upsert).toHaveBeenCalled();
      expect(repoMock.update).toHaveBeenCalledWith('evt-1', { qdrantIndexed: true });
    });

    it('is a no-op when the event does not exist in Postgres', async () => {
      repoMock.findOne.mockResolvedValue(null);
      const qdrant = (
        service as unknown as { qdrant: { getCollections: jest.Mock; upsert: jest.Mock } }
      ).qdrant;
      qdrant.getCollections.mockResolvedValue({ collections: [] });

      await service.embedAndIndex('missing-id', 'content', 'brand-1');
      expect(qdrant.upsert).not.toHaveBeenCalled();
    });

    it('does not update repo when embedding fails', async () => {
      const mockEvent = {
        id: 'evt-1',
        brandId: 'brand-1',
        agent: AgentRole.QA,
        eventType: 'x',
        content: 'x',
        payload: {},
        createdAt: new Date(),
      };
      repoMock.findOne.mockResolvedValue(mockEvent as unknown as MemoryEventEntity);
      const qdrant = (
        service as unknown as {
          qdrant: {
            getCollections: jest.Mock;
            createCollection: jest.Mock;
            createPayloadIndex: jest.Mock;
          };
        }
      ).qdrant;
      qdrant.getCollections.mockResolvedValue({ collections: [] });

      llmRouterMock.embed.mockRejectedValue(new Error('embed error'));

      await service.embedAndIndex('evt-1', 'content', 'brand-1');
      // update should NOT be called — embedding failed before upsert
      expect(repoMock.update).not.toHaveBeenCalled();
    });
  });
});
