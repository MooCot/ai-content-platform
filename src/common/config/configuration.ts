export const configuration = () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USER ?? 'platform',
    password: process.env.DB_PASSWORD ?? 'platform_secret',
    database: process.env.DB_NAME ?? 'content_platform',
  },

  qdrant: {
    url: process.env.QDRANT_URL ?? 'http://localhost:6333',
    apiKey: process.env.QDRANT_API_KEY,
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-ada-002',
    defaultModel: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
    defaultModel: process.env.ANTHROPIC_DEFAULT_MODEL ?? 'claude-3-5-sonnet-20241022',
  },

  google: {
    apiKey: process.env.GOOGLE_AI_API_KEY ?? '',
    defaultModel: process.env.GEMINI_DEFAULT_MODEL ?? 'gemini-1.5-pro',
  },

  llmRouter: {
    fallbackChain: (process.env.LLM_FALLBACK_CHAIN ?? 'claude,openai,gemini').split(','),
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '3', 10),
    retryDelayMs: parseInt(process.env.LLM_RETRY_DELAY_MS ?? '1000', 10),
  },

  rag: {
    chunkSize: parseInt(process.env.RAG_CHUNK_SIZE ?? '512', 10),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP ?? '64', 10),
    searchLimit: parseInt(process.env.RAG_SEARCH_LIMIT ?? '5', 10),
    embeddingDimension: 1536, // OpenAI ada-002 fixed dimension
  },

  streaming: {
    heartbeatIntervalMs: parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS ?? '15000', 10),
    maxDurationMs: parseInt(process.env.STREAM_MAX_DURATION_MS ?? '300000', 10),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
