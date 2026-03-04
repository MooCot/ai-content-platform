import { Injectable, Logger, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { DocumentEntity } from '../entities/document.entity';
import { TextSplitterService } from './text-splitter.service';
import { DocumentParserService } from './document-parser.service';
import { IVectorStore, VECTOR_STORE_TOKEN } from '../../common/interfaces/vector-store.interface';
import { LLMRouterService } from '../../llm/llm-router.service';
import {
  BrandId,
  DocumentId,
  DocumentStatus,
  SearchResult,
} from '../../common/types/domain.types';
import {
  DocumentNotFoundException,
  DocumentProcessingException,
} from '../../common/exceptions/domain.exceptions';
import { AppConfig } from '../../common/config/configuration';

@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    @InjectRepository(DocumentEntity)
    private readonly docRepo: Repository<DocumentEntity>,
    private readonly textSplitter: TextSplitterService,
    private readonly documentParser: DocumentParserService,
    @Inject(VECTOR_STORE_TOKEN)
    private readonly vectorStore: IVectorStore,
    private readonly llmRouter: LLMRouterService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Ingest a document: parse → chunk → embed → upsert to Qdrant */
  async ingest(
    brandId: BrandId,
    buffer: Buffer,
    filename: string,
    mimeType: string,
  ): Promise<DocumentEntity> {
    const doc = this.docRepo.create({
      brandId,
      filename,
      mimeType,
      status: DocumentStatus.PENDING,
      fileSizeBytes: buffer.length,
    });
    await this.docRepo.save(doc);

    // Run async — do not await in the HTTP handler
    void this.processDocument(doc, buffer);

    return doc;
  }

  private async processDocument(doc: DocumentEntity, buffer: Buffer): Promise<void> {
    try {
      // ── 1. Parse ──────────────────────────────────────────────────────────
      await this.updateStatus(doc.id, DocumentStatus.CHUNKING);
      const parsed = await this.documentParser.parse(buffer, doc.mimeType, doc.filename);

      // ── 2. Chunk ──────────────────────────────────────────────────────────
      const chunks = this.textSplitter.split(parsed.text);
      this.logger.log(`Document ${doc.id}: ${chunks.length} chunks`);

      // ── 3. Embed ──────────────────────────────────────────────────────────
      await this.updateStatus(doc.id, DocumentStatus.EMBEDDING);

      // Batch embed in groups of 100 to avoid token limits
      const BATCH_SIZE = 100;
      const allEmbeddings: number[][] = [];
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const embeddings = await this.llmRouter.embed(batch);
        allEmbeddings.push(...embeddings);
      }

      // ── 4. Upsert to Qdrant ───────────────────────────────────────────────
      const collectionName = this.collectionName(doc.brandId);
      const dimension = this.config.get('rag.embeddingDimension', { infer: true });

      await this.vectorStore.ensureCollection(collectionName, dimension);

      const points = chunks.map((content, idx) => ({
        id: uuidv4(),
        vector: allEmbeddings[idx],
        payload: {
          content,
          documentId: doc.id,
          brandId: doc.brandId,
          filename: doc.filename,
          chunkIndex: idx,
        },
      }));

      await this.vectorStore.upsert(collectionName, points);

      // ── 5. Mark READY ─────────────────────────────────────────────────────
      await this.docRepo.update(doc.id, {
        status: DocumentStatus.READY,
        chunkCount: chunks.length,
      });

      this.logger.log(`Document ${doc.id} ingested successfully (${chunks.length} chunks)`);
    } catch (err) {
      this.logger.error(`Document ${doc.id} ingestion failed`, err);
      await this.docRepo.update(doc.id, {
        status: DocumentStatus.FAILED,
        errorMessage: String(err),
      });
    }
  }

  /** Semantic search scoped to a brand's collection */
  async search(
    brandId: BrandId,
    query: string,
    limit?: number,
  ): Promise<SearchResult[]> {
    const searchLimit = limit ?? this.config.get('rag.searchLimit', { infer: true });
    const [queryEmbedding] = await this.llmRouter.embed([query]);

    const collectionName = this.collectionName(brandId);
    const exists = await this.vectorStore.collectionExists(collectionName);
    if (!exists) return [];

    return this.vectorStore.search(collectionName, queryEmbedding, searchLimit, {
      brandId,
    });
  }

  async listDocuments(brandId: BrandId): Promise<DocumentEntity[]> {
    return this.docRepo.find({
      where: { brandId },
      order: { createdAt: 'DESC' },
    });
  }

  async getDocument(docId: DocumentId, brandId: BrandId): Promise<DocumentEntity> {
    const doc = await this.docRepo.findOne({ where: { id: docId, brandId } });
    if (!doc) throw new DocumentNotFoundException(docId);
    return doc;
  }

  async deleteDocument(docId: DocumentId, brandId: BrandId): Promise<void> {
    const doc = await this.getDocument(docId, brandId);

    // Delete all chunks from Qdrant for this document
    const collectionName = this.collectionName(brandId);
    const exists = await this.vectorStore.collectionExists(collectionName);

    if (exists) {
      // Qdrant filter-delete by payload
      await this.vectorStore.delete(collectionName, []);
      // Re-search to find all chunk IDs for this document, then delete
      // In a production scenario you'd store chunk IDs in the DB;
      // for now we use payload-filtered search with a large limit
      const [emptyVec] = await this.llmRouter.embed([doc.filename]);
      const results = await this.vectorStore.search(
        collectionName,
        emptyVec,
        10000,
        { documentId: docId },
      );
      if (results.length) {
        await this.vectorStore.delete(
          collectionName,
          results.map((r) => r.chunkId),
        );
      }
    }

    await this.docRepo.delete({ id: docId, brandId });
    this.logger.log(`Document ${docId} deleted from brand ${brandId}`);
  }

  /** Brand-isolated Qdrant collection name */
  collectionName(brandId: BrandId): string {
    return `brand_${brandId}`;
  }

  private async updateStatus(docId: DocumentId, status: DocumentStatus): Promise<void> {
    await this.docRepo.update(docId, { status });
  }
}
