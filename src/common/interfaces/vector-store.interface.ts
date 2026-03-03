import { BrandId, ChunkMetadata, SearchResult } from '../types/domain.types';

export interface VectorPoint {
  id: string;
  vector: number[];
  payload: ChunkMetadata & { content: string };
}

export interface VectorFilter {
  brandId?: BrandId;
  documentId?: string;
  [key: string]: unknown;
}

export interface IVectorStore {
  ensureCollection(collectionName: string, vectorSize: number): Promise<void>;
  upsert(collectionName: string, points: VectorPoint[]): Promise<void>;
  search(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: VectorFilter,
  ): Promise<SearchResult[]>;
  delete(collectionName: string, ids: string[]): Promise<void>;
  deleteCollection(collectionName: string): Promise<void>;
  collectionExists(collectionName: string): Promise<boolean>;
}

export const VECTOR_STORE_TOKEN = 'VECTOR_STORE';
