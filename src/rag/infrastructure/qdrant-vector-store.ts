import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import {
  IVectorStore,
  VectorFilter,
  VectorPoint,
} from '../../common/interfaces/vector-store.interface';
import { SearchResult } from '../../common/types/domain.types';
import { AppConfig } from '../../common/config/configuration';

@Injectable()
export class QdrantVectorStore implements IVectorStore, OnModuleInit {
  private readonly client: QdrantClient;
  private readonly logger = new Logger(QdrantVectorStore.name);
  private readonly embeddingDimension: number;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const qdrantConfig = this.config.get('qdrant', { infer: true });
    this.client = new QdrantClient({
      url: qdrantConfig.url,
      apiKey: qdrantConfig.apiKey,
    });
    this.embeddingDimension = this.config.get('rag.embeddingDimension', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('QdrantVectorStore initialized');
  }

  async ensureCollection(collectionName: string, vectorSize: number): Promise<void> {
    const exists = await this.collectionExists(collectionName);
    if (exists) return;

    await this.client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: 'Cosine',
      },
      optimizers_config: {
        default_segment_number: 2,
      },
      replication_factor: 1,
    });

    // Create payload index for brandId and documentId filtering
    await this.client.createPayloadIndex(collectionName, {
      field_name: 'brandId',
      field_schema: 'keyword',
    });
    await this.client.createPayloadIndex(collectionName, {
      field_name: 'documentId',
      field_schema: 'keyword',
    });

    this.logger.log(`Created Qdrant collection: ${collectionName}`);
  }

  async upsert(collectionName: string, points: VectorPoint[]): Promise<void> {
    await this.ensureCollection(collectionName, this.embeddingDimension);

    const qdrantPoints = points.map((p) => ({
      id: p.id,
      vector: p.vector,
      payload: p.payload as unknown as Record<string, unknown>,
    }));

    await this.client.upsert(collectionName, {
      wait: true,
      points: qdrantPoints,
    });
  }

  async search(
    collectionName: string,
    vector: number[],
    limit: number,
    filter?: VectorFilter,
  ): Promise<SearchResult[]> {
    const qdrantFilter = filter ? this.buildFilter(filter) : undefined;

    const results = await this.client.search(collectionName, {
      vector,
      limit,
      filter: qdrantFilter,
      with_payload: true,
    });

    return results.map((r) => ({
      chunkId: String(r.id),
      content: (r.payload as { content: string }).content,
      score: r.score,
      metadata: r.payload as unknown as SearchResult['metadata'],
    }));
  }

  async delete(collectionName: string, ids: string[]): Promise<void> {
    await this.client.delete(collectionName, {
      wait: true,
      points: ids,
    });
  }

  async deleteCollection(collectionName: string): Promise<void> {
    const exists = await this.collectionExists(collectionName);
    if (!exists) return;
    await this.client.deleteCollection(collectionName);
    this.logger.log(`Deleted Qdrant collection: ${collectionName}`);
  }

  async collectionExists(collectionName: string): Promise<boolean> {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some((c) => c.name === collectionName);
    } catch {
      return false;
    }
  }

  private buildFilter(filter: VectorFilter): Record<string, unknown> {
    const must: Array<Record<string, unknown>> = [];

    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined) {
        must.push({
          key,
          match: { value },
        });
      }
    }

    return must.length ? { must } : {};
  }
}
