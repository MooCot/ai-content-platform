import { z } from 'zod';

export const CONTRACT_NAME = 'RetrievalResultV1';

// ── Document chunk metadata ───────────────────────────────────────────────────

/**
 * Metadata attached to every vector point in Qdrant.
 * Enforces brand isolation: every chunk must carry its owning brandId.
 */
export const DocumentChunkContractV1 = z.object({
  documentId: z.string().min(1),
  brandId: z.string().min(1),
  filename: z.string().min(1),
  page: z.number().int().min(0).optional(),
  section: z.string().optional(),
  chunkIndex: z.number().int().min(0),
});

export type DocumentChunk = z.infer<typeof DocumentChunkContractV1>;

// ── Single retrieval result ───────────────────────────────────────────────────

/**
 * A single ranked result from semantic search.
 *
 * κ-invariant: brandId in metadata must match the query brandId.
 * Enforced at the service layer by filtering invalid results
 * rather than throwing, to avoid degrading a partial result set.
 */
export const RetrievalResultContractV1 = z.object({
  /** Qdrant point ID (UUID). */
  chunkId: z.string().min(1),

  /** Raw text of the chunk as stored. */
  content: z.string().min(1),

  /** Cosine similarity score in [0, 1]. */
  score: z.number().min(0).max(1),

  metadata: DocumentChunkContractV1,
});

export type RetrievalResult = z.infer<typeof RetrievalResultContractV1>;

// ── Embedding version guard ───────────────────────────────────────────────────

/**
 * Guards embedding dimensionality compatibility.
 * OpenAI text-embedding-3-small = 1536 dims.
 * Changing embedding models requires re-indexing all collections.
 */
export const EmbeddingVersionContractV1 = z.object({
  model: z.string().min(1),
  dimension: z.number().int().positive(),
  collectionName: z
    .string()
    .regex(/^brand_[a-zA-Z0-9_-]+$/, 'Collection name must follow brand_{brandId} pattern'),
});

export type EmbeddingVersion = z.infer<typeof EmbeddingVersionContractV1>;
