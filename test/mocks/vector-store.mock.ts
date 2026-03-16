import { IVectorStore, VectorPoint } from '../../src/common/interfaces/vector-store.interface';
import { SearchResult } from '../../src/common/types/domain.types';

/**
 * In-memory mock of IVectorStore backed by a simple Map.
 * Simulates collection management and nearest-neighbour search via dot product.
 */
export class MockVectorStore implements IVectorStore {
  private collections = new Map<string, VectorPoint[]>();

  async ensureCollection(name: string, _dimension: number): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, []);
    }
  }

  async collectionExists(name: string): Promise<boolean> {
    return this.collections.has(name);
  }

  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    const collection = this.collections.get(collectionName) ?? [];
    for (const point of points) {
      const idx = collection.findIndex((p) => p.id === point.id);
      if (idx >= 0) {
        collection[idx] = point;
      } else {
        collection.push(point);
      }
    }
    this.collections.set(collectionName, collection);
  }

  async search(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<SearchResult[]> {
    const collection = this.collections.get(collectionName) ?? [];

    let filtered = collection;
    if (filter) {
      filtered = collection.filter((point) => {
        const p = point.payload as unknown as Record<string, unknown>;
        return Object.entries(filter).every(([key, value]) => p[key] === value);
      });
    }

    // Simple dot-product similarity
    const scored = filtered.map((point) => {
      const p = point.payload as unknown as Record<string, unknown>;
      return {
        chunkId: point.id,
        content: (p['content'] as string) ?? '',
        score: dotProduct(vector, point.vector),
        metadata: p,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => ({
        chunkId: s.chunkId,
        content: s.content,
        score: s.score,
        metadata: {
          documentId: (s.metadata['documentId'] as string) ?? '',
          brandId: (s.metadata['brandId'] as string) ?? '',
          filename: (s.metadata['filename'] as string) ?? '',
          chunkIndex: (s.metadata['chunkIndex'] as number) ?? 0,
        },
      }));
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    const collection = this.collections.get(collectionName) ?? [];
    if (ids.length === 0) return;
    this.collections.set(
      collectionName,
      collection.filter((p) => !ids.includes(p.id)),
    );
  }

  async deleteCollection(collectionName: string): Promise<void> {
    this.collections.delete(collectionName);
  }

  /** Test helper: inspect raw collection contents. */
  getCollectionPoints(name: string): VectorPoint[] {
    return this.collections.get(name) ?? [];
  }

  /** Test helper: clear all data. */
  reset(): void {
    this.collections.clear();
  }
}

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * (b[i] ?? 0), 0);
}
