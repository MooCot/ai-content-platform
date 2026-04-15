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

  alibaba: {
    apiKey: process.env.DASHSCOPE_API_KEY ?? '',
    defaultModel: process.env.ALIBABA_DEFAULT_MODEL ?? 'qwen-plus',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  },

  llmRouter: {
    fallbackChain: (process.env.LLM_FALLBACK_CHAIN ?? 'claude,openai,gemini,alibaba').split(','),
    embeddingProvider: process.env.EMBEDDING_PROVIDER ?? 'openai',
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES ?? '3', 10),
    retryDelayMs: parseInt(process.env.LLM_RETRY_DELAY_MS ?? '1000', 10),
    circuitBreaker: {
      /** Consecutive failures before a provider's circuit opens */
      failureThreshold: parseInt(process.env.LLM_CB_FAILURE_THRESHOLD ?? '5', 10),
      /** Milliseconds a circuit stays OPEN before allowing one test request (HALF_OPEN) */
      cooldownMs: parseInt(process.env.LLM_CB_COOLDOWN_MS ?? '30000', 10),
    },
  },

  rag: {
    chunkSize: parseInt(process.env.RAG_CHUNK_SIZE ?? '512', 10),
    chunkOverlap: parseInt(process.env.RAG_CHUNK_OVERLAP ?? '64', 10),
    searchLimit: parseInt(process.env.RAG_SEARCH_LIMIT ?? '5', 10),
    embeddingDimension: parseInt(process.env.EMBEDDING_DIMENSION ?? '1536', 10),
  },

  streaming: {
    heartbeatIntervalMs: parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS ?? '15000', 10),
    maxDurationMs: parseInt(process.env.STREAM_MAX_DURATION_MS ?? '300000', 10),
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  observability: {
    otlpEndpoint:
      process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? 'http://localhost:4318/v1/traces',
    metricsEnabled: process.env.METRICS_ENABLED !== 'false',
    // Cost per 1K tokens (USD). Override per model via env as needed.
    tokenCostPerKUsd: {
      'claude-3-5-sonnet-20241022': 0.003,
      'gpt-4o': 0.005,
      'gemini-1.5-pro': 0.00125,
    } as Record<string, number>,
  },

  evaluation: {
    memoryIndexingThreshold: parseFloat(process.env.MEMORY_INDEXING_THRESHOLD ?? '0.70'),
    compositeWeights: {
      relevance: 0.3,
      tone: 0.25,
      factuality: 0.25,
      readability: 0.2,
    },
  },

  resilience: {
    /** BullMQ waiting+active+delayed jobs — triggers degraded mode above this depth. */
    queueDepthThreshold: parseInt(process.env.QUEUE_DEPTH_THRESHOLD ?? '50', 10),
    /** RAG search timeout (ms) — pipeline continues without context on expiry. */
    ragTimeoutMs: parseInt(process.env.RAG_TIMEOUT_MS ?? '5000', 10),
    /** End-to-end latency budget (ms) — optional agents are skipped when exceeded. */
    latencyBudgetMs: parseInt(process.env.PIPELINE_LATENCY_BUDGET_MS ?? '90000', 10),
  },
});

export type AppConfig = ReturnType<typeof configuration>;
