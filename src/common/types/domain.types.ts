// ─── Primitive aliases ────────────────────────────────────────────────────────
export type BrandId = string;
export type DocumentId = string;
export type JobId = string;
export type StreamId = string;
export type ModelId = string;

// ─── Enums ────────────────────────────────────────────────────────────────────
export enum Tone {
  FORMAL = 'FORMAL',
  CASUAL = 'CASUAL',
  TECHNICAL = 'TECHNICAL',
  FRIENDLY = 'FRIENDLY',
  PERSUASIVE = 'PERSUASIVE',
}

export enum ContentType {
  BLOG = 'BLOG',
  SOCIAL = 'SOCIAL',
  EMAIL = 'EMAIL',
  LANDING_PAGE = 'LANDING_PAGE',
  PRODUCT_DESCRIPTION = 'PRODUCT_DESCRIPTION',
}

export enum DocumentStatus {
  PENDING = 'PENDING',
  CHUNKING = 'CHUNKING',
  EMBEDDING = 'EMBEDDING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export enum JobStatus {
  QUEUED = 'QUEUED',
  RUNNING = 'RUNNING',
  RETRYING = 'RETRYING',
  DONE = 'DONE',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}

// ─── Memory types ─────────────────────────────────────────────────────────────
export type MemoryEventId = string;

export interface RelevantMemory {
  eventId: MemoryEventId;
  agent: AgentRole;
  eventType: string;
  content: string;
  score: number;
  createdAt: Date;
}

// ─── Evaluation types ─────────────────────────────────────────────────────────
export interface EvaluationDimensions {
  relevance: { score: number };
  tone: { score: number; detected: string; target: string };
  factuality: { score: number; supportedClaims: number; totalClaims: number };
  readability: { score: number };
}

export interface CompositeScoreInput {
  relevance: number;
  tone: number;
  factuality: number;
  readability: number; // already normalized 0-1
}

export enum AgentRole {
  PLANNER = 'PLANNER',
  RESEARCHER = 'RESEARCHER',
  GENERATOR = 'GENERATOR',
  OPTIMIZER = 'OPTIMIZER',
  QA = 'QA',
}

export enum LLMProvider {
  OPENAI = 'openai',
  CLAUDE = 'claude',
  GEMINI = 'gemini',
}

// ─── Domain value objects ─────────────────────────────────────────────────────
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ToneAnalysis {
  detected: Tone;
  confidence: number;
  scores: Record<Tone, number>;
}

export interface AgentStep {
  agent: AgentRole;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  modelUsed: ModelId;
  durationMs: number;
  tokens: TokenUsage;
  startedAt: Date;
}

export interface ContentResult {
  raw: string;
  optimized: string;
  seoKeywords: string[];
  readabilityScore: number;
  toneAnalysis: ToneAnalysis;
  wordCount: number;
  citations: string[];
  /** Present when the pipeline ran in degraded mode; absent on clean runs. */
  degraded?: boolean;
  degradationReasons?: string[];
}

export interface ChunkMetadata {
  documentId: DocumentId;
  brandId: BrandId;
  filename: string;
  page?: number;
  section?: string;
  chunkIndex: number;
}

export interface SearchResult {
  chunkId: string;
  content: string;
  score: number;
  metadata: ChunkMetadata;
}
