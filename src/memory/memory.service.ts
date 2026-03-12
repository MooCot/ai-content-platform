import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QdrantClient } from '@qdrant/js-client-rest';
import { ConfigService } from '@nestjs/config';
import { MemoryEventEntity } from './entities/memory-event.entity';
import { LLMRouterService } from '../llm/llm-router.service';
import { AgentRole, RelevantMemory } from '../common/types/domain.types';
import { AppConfig } from '../common/config/configuration';

const MEMORY_COLLECTION = (brandId: string) => `brand_${brandId}_memory`;
const EMBEDDING_DIMENSION = 1536; // OpenAI ada-002

export interface RecordMemoryParams {
  brandId: string;
  jobId: string | null;
  agent: AgentRole;
  eventType: string;
  /** Textual summary stored in Postgres and used as Qdrant payload. */
  content: string;
  payload: Record<string, unknown>;
  promptVersion?: string;
}

export interface MemoryQueryOptions {
  eventType?: string;
  limit?: number;
  /** Only return events created after this date. */
  sinceDate?: Date;
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);
  private readonly qdrant: QdrantClient;

  constructor(
    @InjectRepository(MemoryEventEntity)
    private readonly repo: Repository<MemoryEventEntity>,
    private readonly llmRouter: LLMRouterService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    const { url, apiKey } = this.config.get('qdrant', { infer: true });
    this.qdrant = new QdrantClient({ url, apiKey });
  }

  /** Persist a memory event to Postgres (always). Returns the saved entity. */
  async record(params: RecordMemoryParams): Promise<MemoryEventEntity> {
    const event = this.repo.create({
      brandId: params.brandId,
      jobId: params.jobId,
      agent: params.agent,
      eventType: params.eventType,
      content: params.content,
      payload: params.payload,
      promptVersion: params.promptVersion ?? '0.0.0',
      qdrantIndexed: false,
    });
    return this.repo.save(event);
  }

  /**
   * Semantic search across indexed (high-quality) memories for a brand.
   * Falls back to empty array if the collection does not exist yet.
   */
  async queryRelevant(
    brandId: string,
    topic: string,
    opts: MemoryQueryOptions = {},
  ): Promise<RelevantMemory[]> {
    const collection = MEMORY_COLLECTION(brandId);
    const limit = opts.limit ?? 5;

    // Guard: if collection doesn't exist, return empty (no memories indexed yet)
    if (!(await this.collectionExists(collection))) return [];

    let vector: number[];
    try {
      [vector] = await this.llmRouter.embed([topic]);
    } catch (err) {
      this.logger.warn(`Memory embed failed, skipping recall: ${String(err)}`);
      return [];
    }

    const filter: Record<string, unknown> = {};
    if (opts.eventType) {
      filter['must'] = [{ key: 'eventType', match: { value: opts.eventType } }];
    }

    try {
      const results = await this.qdrant.search(collection, {
        vector,
        limit,
        with_payload: true,
        filter: Object.keys(filter).length ? filter : undefined,
      });

      return results.map((r) => ({
        eventId: String(r.id),
        agent: (r.payload as Record<string, unknown>)['agent'] as AgentRole,
        eventType: (r.payload as Record<string, unknown>)['eventType'] as string,
        content: (r.payload as Record<string, unknown>)['content'] as string,
        score: r.score,
        createdAt: new Date((r.payload as Record<string, unknown>)['createdAt'] as string),
      }));
    } catch (err) {
      this.logger.warn(`Memory search failed: ${String(err)}`);
      return [];
    }
  }

  /**
   * Embed `content` and upsert to the brand's Qdrant memory collection.
   * Called by EvaluationService when composite_score >= threshold.
   * Updates the MemoryEventEntity to mark it as indexed.
   */
  async embedAndIndex(eventId: string, content: string, brandId: string): Promise<void> {
    const collection = MEMORY_COLLECTION(brandId);
    await this.ensureCollection(collection);

    let vector: number[];
    try {
      [vector] = await this.llmRouter.embed([content]);
    } catch (err) {
      this.logger.error(`Memory embed failed for event ${eventId}: ${String(err)}`);
      return;
    }

    const event = await this.repo.findOne({ where: { id: eventId } });
    if (!event) {
      this.logger.warn(`Memory event ${eventId} not found — skipping index`);
      return;
    }

    await this.qdrant.upsert(collection, {
      wait: true,
      points: [
        {
          id: eventId,
          vector,
          payload: {
            eventId,
            brandId,
            agent: event.agent,
            eventType: event.eventType,
            content: event.content,
            createdAt: event.createdAt.toISOString(),
            ...event.payload,
          },
        },
      ],
    });

    await this.repo.update(eventId, { qdrantIndexed: true });
    this.logger.debug(`Memory event ${eventId} indexed in Qdrant collection ${collection}`);
  }

  private async ensureCollection(name: string): Promise<void> {
    if (await this.collectionExists(name)) return;
    await this.qdrant.createCollection(name, {
      vectors: { size: EMBEDDING_DIMENSION, distance: 'Cosine' },
    });
    await this.qdrant.createPayloadIndex(name, {
      field_name: 'brandId',
      field_schema: 'keyword',
    });
    await this.qdrant.createPayloadIndex(name, {
      field_name: 'eventType',
      field_schema: 'keyword',
    });
    this.logger.log(`Created Qdrant memory collection: ${name}`);
  }

  private async collectionExists(name: string): Promise<boolean> {
    try {
      const { collections } = await this.qdrant.getCollections();
      return collections.some((c) => c.name === name);
    } catch {
      return false;
    }
  }
}
