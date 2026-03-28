// Mock QdrantClient before imports
const mockGetCollections = jest.fn();
const mockCreateCollection = jest.fn();
const mockCreatePayloadIndex = jest.fn();
const mockUpsert = jest.fn();
const mockSearch = jest.fn();
const mockDelete = jest.fn();
const mockDeleteCollection = jest.fn();

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollections: mockGetCollections,
    createCollection: mockCreateCollection,
    createPayloadIndex: mockCreatePayloadIndex,
    upsert: mockUpsert,
    search: mockSearch,
    delete: mockDelete,
    deleteCollection: mockDeleteCollection,
  })),
}));

import { QdrantVectorStore } from './qdrant-vector-store';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

function makeStore() {
  return new QdrantVectorStore(
    createMockConfigService({
      'qdrant.url': 'http://localhost:6333',
      'qdrant.apiKey': undefined,
      'rag.embeddingDimension': 1536,
    }),
  );
}

const COLLECTION = 'brand_test';
const VECTOR = Array(1536).fill(0.1);

describe('QdrantVectorStore', () => {
  let store: QdrantVectorStore;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCollections.mockResolvedValue({ collections: [] });
    mockCreateCollection.mockResolvedValue(undefined);
    mockCreatePayloadIndex.mockResolvedValue(undefined);
    mockUpsert.mockResolvedValue(undefined);
    mockSearch.mockResolvedValue([]);
    mockDelete.mockResolvedValue(undefined);
    mockDeleteCollection.mockResolvedValue(undefined);
    store = makeStore();
  });

  // ── collectionExists() ────────────────────────────────────────────────────

  it('returns false when collection is not in the list', async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: 'other' }] });
    expect(await store.collectionExists(COLLECTION)).toBe(false);
  });

  it('returns true when collection is in the list', async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: COLLECTION }] });
    expect(await store.collectionExists(COLLECTION)).toBe(true);
  });

  it('returns false (gracefully) when getCollections throws', async () => {
    mockGetCollections.mockRejectedValue(new Error('Qdrant unreachable'));
    expect(await store.collectionExists(COLLECTION)).toBe(false);
  });

  // ── ensureCollection() ────────────────────────────────────────────────────

  it('creates the collection when it does not exist', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    await store.ensureCollection(COLLECTION, 1536);
    expect(mockCreateCollection).toHaveBeenCalledWith(
      COLLECTION,
      expect.objectContaining({ vectors: { size: 1536, distance: 'Cosine' } }),
    );
  });

  it('creates payload indexes for brandId and documentId', async () => {
    await store.ensureCollection(COLLECTION, 1536);
    expect(mockCreatePayloadIndex).toHaveBeenCalledWith(
      COLLECTION,
      expect.objectContaining({ field_name: 'brandId', field_schema: 'keyword' }),
    );
    expect(mockCreatePayloadIndex).toHaveBeenCalledWith(
      COLLECTION,
      expect.objectContaining({ field_name: 'documentId', field_schema: 'keyword' }),
    );
  });

  it('skips creation when the collection already exists', async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: COLLECTION }] });
    await store.ensureCollection(COLLECTION, 1536);
    expect(mockCreateCollection).not.toHaveBeenCalled();
  });

  // ── upsert() ──────────────────────────────────────────────────────────────

  const VALID_POINT = {
    id: 'uuid-1',
    vector: VECTOR,
    payload: {
      content: 'text',
      brandId: 'b1',
      documentId: 'doc-1',
      filename: 'file.pdf',
      chunkIndex: 0,
    },
  };

  it('calls qdrant client upsert with wait: true', async () => {
    await store.upsert(COLLECTION, [VALID_POINT]);
    expect(mockUpsert).toHaveBeenCalledWith(COLLECTION, expect.objectContaining({ wait: true }));
  });

  it('maps VectorPoints to Qdrant format', async () => {
    await store.upsert(COLLECTION, [VALID_POINT]);
    const [, params] = mockUpsert.mock.calls[0];
    expect(params.points[0]).toMatchObject({ id: 'uuid-1', vector: VECTOR });
  });

  // ── search() ──────────────────────────────────────────────────────────────

  it('maps Qdrant results to SearchResult shape', async () => {
    mockSearch.mockResolvedValue([
      {
        id: 'chunk-1',
        score: 0.92,
        payload: {
          content: 'Relevant text',
          brandId: 'b1',
          documentId: 'doc-1',
          filename: 'file.pdf',
          chunkIndex: 0,
        },
      },
    ]);
    const results = await store.search(COLLECTION, VECTOR, 5);
    expect(results).toHaveLength(1);
    expect(results[0].chunkId).toBe('chunk-1');
    expect(results[0].score).toBe(0.92);
    expect(results[0].content).toBe('Relevant text');
  });

  it('passes limit to Qdrant search', async () => {
    await store.search(COLLECTION, VECTOR, 10);
    const [, params] = mockSearch.mock.calls[0];
    expect(params.limit).toBe(10);
  });

  it('builds a filter from VectorFilter when provided', async () => {
    await store.search(COLLECTION, VECTOR, 5, { brandId: 'b1' });
    const [, params] = mockSearch.mock.calls[0];
    expect(params.filter).toEqual({
      must: [{ key: 'brandId', match: { value: 'b1' } }],
    });
  });

  it('passes no filter when VectorFilter is undefined', async () => {
    await store.search(COLLECTION, VECTOR, 5);
    const [, params] = mockSearch.mock.calls[0];
    expect(params.filter).toBeUndefined();
  });

  it('omits undefined filter values from the must array', async () => {
    await store.search(COLLECTION, VECTOR, 5, { brandId: 'b1', documentId: undefined });
    const [, params] = mockSearch.mock.calls[0];
    expect(params.filter.must).toHaveLength(1);
    expect(params.filter.must[0].key).toBe('brandId');
  });

  // ── delete() ──────────────────────────────────────────────────────────────

  it('calls qdrant delete with wait: true and the provided ids', async () => {
    await store.delete(COLLECTION, ['id-1', 'id-2']);
    expect(mockDelete).toHaveBeenCalledWith(
      COLLECTION,
      expect.objectContaining({ wait: true, points: ['id-1', 'id-2'] }),
    );
  });

  // ── deleteCollection() ────────────────────────────────────────────────────

  it('calls qdrant deleteCollection when collection exists', async () => {
    mockGetCollections.mockResolvedValue({ collections: [{ name: COLLECTION }] });
    await store.deleteCollection(COLLECTION);
    expect(mockDeleteCollection).toHaveBeenCalledWith(COLLECTION);
  });

  it('skips deleteCollection when collection does not exist', async () => {
    mockGetCollections.mockResolvedValue({ collections: [] });
    await store.deleteCollection(COLLECTION);
    expect(mockDeleteCollection).not.toHaveBeenCalled();
  });
});
