# Multi-Brand AI Content Platform

Production-grade AI content generation platform built with NestJS, featuring multi-tenant RAG, agent pipelines, multi-LLM routing, and real-time SSE streaming.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           HTTP API  (NestJS)                             │
│  /brands  │  /rag  │  /content  │  /stream  │  /evaluations  │  /metrics │
└──┬────────┴───┬────┴──────┬─────┴─────┬─────┴───────┬────────┴─────┬────┘
   │            │           │           │             │              │
   ▼            ▼           ▼           ▼             ▼              ▼
Brands        RAG       Content      Streaming   Evaluation    Observability
Module       Module      Module       Module       Module     (metrics/tracing)
               │           │                        │
               │           ▼                        │
               │     Queue Module ──────────────────┘
               │     (BullMQ/Redis)
               │           │
               │           ▼
               │     Agent Pipeline
               │     Planner→Researcher→Generator→Optimizer→QA
               │           │
               └───────────┤
                           ▼
                  ┌─────────────────────┐
                  │     LLM Router      │
                  │ Claude│OpenAI│Gemini│
                  │  retry + fallback   │
                  └─────────┬───────────┘
                            │
                  ┌─────────▼─────────────────────┐
                  │        Infrastructure          │
                  │ PostgreSQL │ Qdrant │  Redis   │
                  └───────────────────────────────┘
```

### Agent Pipeline

```
POST /brands/:id/content/generate
          │
          ▼
    ContentService         enqueues BullMQ job (idempotent by jobId)
          │
          ▼  [Redis queue]
    ContentPipelineProcessor  (concurrency: 5, 3 retries, exp. backoff)
          │
          ▼
    PlannerAgent           ← Claude (structured JSON)
    (outline, queries, tone)
          │
          ▼
    ResearcherAgent        ← Qdrant RAG + episodic memory recall (200 ms timeout)
    (RAG context, past memories, citations)
          │
          ▼
    GeneratorAgent         ← Claude (streaming → SSE tokens)
    (draft content)
          │
          ▼
    OptimizerAgent         ← OpenAI + SEO/Tone tools
    (optimized content, keywords)
          │
          ▼
    QAAgent                ← Claude + Readability tool
    (final content, quality score)
          │
          ├─► SSE: job_done event
          │
          └─► EvaluationService (fire-and-forget)
                relevance + tone + factuality → composite score
                if score ≥ 0.70 → embed into episodic memory (Qdrant)
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 + TypeScript strict |
| Database | PostgreSQL 16 (TypeORM) |
| Vector DB | Qdrant 1.9 |
| Job queue | BullMQ 5 + Redis (ioredis) |
| LLM providers | OpenAI (GPT-4o), Claude (claude-sonnet-4-6), Gemini 1.5 Pro |
| Streaming | Server-Sent Events (SSE) |
| Validation | class-validator + Zod (structured LLM output) |
| Observability | OpenTelemetry SDK + prom-client (Prometheus) |
| Testing | Jest + Supertest · integration mocks · k6 load tests |

## Quick Start

```bash
# 1. Copy environment
cp .env.example .env
# Fill in: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY
# Redis (required for queue): REDIS_HOST=localhost, REDIS_PORT=6379, REDIS_PASSWORD=

# 2. Start infrastructure (Postgres + Qdrant + Redis)
docker-compose up -d

# 3. Install and run
npm install
npm run start:dev

# 4. Open docs
open http://localhost:3000/docs
```

## API Reference

### Brands

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/brands` | Create brand |
| `GET` | `/api/v1/brands` | List all brands |
| `GET` | `/api/v1/brands/:id` | Get brand |
| `PATCH` | `/api/v1/brands/:id/config` | Update brand config |
| `DELETE` | `/api/v1/brands/:id` | Deactivate brand |

### RAG

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/brands/:brandId/rag/upload` | Upload document (multipart) |
| `GET` | `/api/v1/brands/:brandId/rag/documents` | List documents |
| `GET` | `/api/v1/brands/:brandId/rag/search?query=...` | Semantic search |
| `DELETE` | `/api/v1/brands/:brandId/rag/:docId` | Delete document |

### Content Generation

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/brands/:brandId/content/generate` | Enqueue content job (async) |
| `GET` | `/api/v1/brands/:brandId/content` | List jobs |
| `GET` | `/api/v1/brands/:brandId/content/:jobId` | Get job + result |

### Evaluations

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/brands/:brandId/evaluations` | List evaluation records (`?limit=50`) |
| `GET` | `/api/v1/brands/:brandId/evaluations/compare` | Compare two models (`?modelA=&modelB=`) |

### Observability

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/metrics` | Prometheus metrics scrape endpoint |

### Streaming

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/stream/:jobId` | SSE stream (tokens + agent steps) |
| `DELETE` | `/api/v1/stream/:jobId` | Cancel stream |

### SSE Event Types

```
event: agent_start   data: { "agent": "PLANNER" }
event: token         data: { "delta": "Hello" }
event: agent_done    data: { "agent": "PLANNER", "durationMs": 1200 }
event: job_done      data: { "jobId": "...", "status": "DONE", "result": {...} }
event: error         data: { "message": "..." }
event: heartbeat     data: {}
```

## Example Usage

```bash
# Create a brand
curl -X POST http://localhost:3000/api/v1/brands \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "techblog",
    "name": "Tech Blog",
    "config": {
      "defaultTone": "TECHNICAL",
      "allowedModels": ["claude-sonnet-4-6", "gpt-4o"],
      "preferredProvider": "claude",
      "ragEnabled": true,
      "systemPrompt": "You are a technical writer for a developer-focused blog.",
      "maxContentLength": 2000
    }
  }'

# Upload a document
curl -X POST http://localhost:3000/api/v1/brands/{brandId}/rag/upload \
  -F "file=@docs/architecture.pdf"

# Generate content
curl -X POST http://localhost:3000/api/v1/brands/{brandId}/content/generate \
  -H "Content-Type: application/json" \
  -d '{ "topic": "Introduction to Vector Databases", "contentType": "BLOG" }'

# Stream the result
curl -N http://localhost:3000/api/v1/stream/{jobId}
```

## Testing

### Running tests

```bash
npm run test               # unit tests (src/**/*.spec.ts)
npm run test:cov           # unit tests + coverage report
npm run test:integration   # integration tests (test/integration/)
npm run test:e2e           # E2E tests via Supertest (test/e2e/)
npm run test:ai-eval       # AI evaluation regression (test/ai-eval/)
npm run test:all           # unit + integration + e2e in sequence

# Single file
npx jest src/llm/llm-router.service.spec.ts --no-coverage

# Load tests (k6 required)
k6 run --env BASE_URL=http://localhost:3000 --env BRAND_ID=<id> test/load/content-pipeline.k6.js
```

### Test layers

| Layer | Location | Scope | External deps |
|---|---|---|---|
| Unit | `src/**/*.spec.ts` | Single service/class | All mocked |
| Integration | `test/integration/` | Module composition, state machines | LLM/Qdrant/Redis mocked |
| E2E | `test/e2e/` | Full HTTP API via Supertest | All mocked, real NestJS app |
| AI Eval | `test/ai-eval/` | Semantic quality regression | Golden dataset thresholds |
| Load | `test/load/` | Throughput, latency, queue backpressure | Requires running server |

### Shared test infrastructure

- **`test/mocks/llm-provider.mock.ts`** — `MockLLMProvider` with `createFlakyProvider(n)` / `createFailingProvider()` for retry/fallback scenarios
- **`test/mocks/vector-store.mock.ts`** — In-memory `IVectorStore` with dot-product scoring and `getCollectionPoints()` for assertions
- **`test/mocks/queue.mock.ts`** — `MockQueueService` that captures `enqueue()` calls; inspect with `getEnqueuedJobs()`
- **`test/utils/repository.mock.ts`** — `createRepositoryMock<T>()` — TypeORM `jest.fn()` stubs
- **`test/utils/mock-config.service.ts`** — `createMockConfigService()` delegates to the real `configuration()` factory
- **`test/utils/test-app.factory.ts`** — `createTestApp()` boots the full `AppModule` with all external services swapped to mocks (no Docker needed for E2E)

### Golden dataset (AI eval)

`test/ai-eval/golden-dataset.ts` defines versioned quality thresholds per topic/content type:

- Entries are **append-only** — never edit; set `disabled: true` to retire
- Each entry specifies: required keywords, forbidden phrases, and min scores per dimension
- Bump `PROMPT_VERSION` in `EvaluationService` and add new entries when prompts change
- Set `EVAL_USE_REAL_LLM=true` to run against live providers (CI nightly only)

### κ-invariants tested

| Invariant | Test location |
|---|---|
| Agent pipeline order: PLANNER → RESEARCHER → GENERATOR → OPTIMIZER → QA | `agent-orchestrator.service.spec.ts` |
| Brand isolation in DB queries and Qdrant collections | `rag.service.spec.ts`, `content.service.spec.ts`, `content-generation.e2e-spec.ts` |
| RAG status machine: PENDING → CHUNKING → EMBEDDING → READY | `rag-pipeline.spec.ts` |
| Job status machine: QUEUED → RUNNING → DONE\|FAILED\|CANCELLED\|RETRYING | `content-pipeline.spec.ts`, `content-pipeline.processor.spec.ts` |
| Memory quality gate: `embedAndIndex()` only when composite ≥ 0.70 | `evaluation.service.spec.ts` |
| Evaluation is fire-and-forget: `evaluate()` never throws | `evaluation.service.spec.ts` |
| Embeddings only via OpenAI provider | `llm-router.service.spec.ts` |
| Composite score ≥ threshold for every golden entry | `prompt-regression.spec.ts` |

---

## CI/CD

### Pipeline

Два независимых workflow на GitHub Actions.

**`ci.yml`** — triggers on every push and on PRs targeting `master`:

```
install
   ├── lint            (parallel)
   ├── typecheck       (parallel)
   └── test:unit       (coverage artifact)
        └── test:integration
              └── test:e2e
```

**`deploy.yml`** — triggers only on push to `master`:

```
build
  Dockerfile → ghcr.io/<owner>/content-platform:<sha>
  BuildKit layer cache from previous :stable image
       │
       ▼
deploy-staging
  kubectl apply → namespace content-platform-staging
  Waits for rollout status → smoke-test.sh
       │
       ▼
deploy-canary                        10% of traffic
  kubectl apply deployment-canary    NGINX canary-weight=10
  1 replica, DEPLOY_TRACK=canary in env
       │
       ▼
verify-canary                        ~2 minutes observation
  Prometheus: error rate < 1%
  Prometheus: p99 latency < 2000ms
  Polls every 15 seconds
       │
   FAIL ──► inline rollback
       │     deletes canary Deployment
       │     removes NGINX annotations
       │     100% traffic back on stable
       │
      OK
       │
       ▼
deploy-production
  RollingUpdate stable → 3 replicas, maxUnavailable=0
  Deletes canary Deployment
  Retags <sha> → :stable in GHCR
  smoke-test.sh
       │
       ▼
release
  semantic-release → CHANGELOG.md + GitHub Release + git tag
```

### Canary deployment

Traffic splitting is handled via NGINX Ingress annotations:

```yaml
nginx.ingress.kubernetes.io/canary: "true"
nginx.ingress.kubernetes.io/canary-weight: "10"
```

Both `Deployment` resources (stable and canary) sit behind the same `Service`. Once the canary passes verification the annotations are removed and 100% of traffic returns to stable.

### GitHub Secrets

| Secret | Description |
|---|---|
| `KUBE_CONFIG_STAGING` | base64-encoded kubeconfig for the staging cluster |
| `KUBE_CONFIG_PROD` | base64-encoded kubeconfig for the production cluster |
| `DB_HOST_STAGING` / `DB_HOST_PROD` | PostgreSQL host |
| `DB_PASSWORD_STAGING` | Database password (staging) |
| `QDRANT_URL_STAGING` / `QDRANT_URL_PROD` | Qdrant URL |
| `QDRANT_API_KEY` | Qdrant API key |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `GOOGLE_AI_API_KEY` | Google Gemini |
| `PROMETHEUS_URL` | Internal Prometheus address (used by canary verification) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connection for BullMQ |
| `OTLP_ENDPOINT` | OpenTelemetry collector endpoint |

`GITHUB_TOKEN` is provided automatically by GitHub Actions — no configuration needed. Used for GHCR authentication and semantic-release.

---

## Observability

- **Traces**: OTLP HTTP → any collector (Jaeger, Tempo, Datadog). Auto-instrumented: HTTP, PostgreSQL, Redis.
- **Metrics**: `GET /api/v1/metrics` returns Prometheus text format. Key metrics:
  - `content_platform_llm_tokens_total` — token usage by provider/model/type
  - `content_platform_llm_cost_usd_total` — estimated USD cost
  - `content_platform_pipeline_latency_ms` — end-to-end pipeline duration by content type
  - `content_platform_queue_depth` — current BullMQ queue depth
  - `content_platform_evaluation_score` — composite quality scores by content type/model
- **Correlation IDs**: `X-Correlation-ID` header is generated (or passed through) on every request, propagated to queue jobs, agent context, and SSE events.

## LLM Fallback Chain

Configured via `LLM_FALLBACK_CHAIN=claude,openai,gemini`. On 429/rate-limit/503 the router retries up to `LLM_MAX_RETRIES` times with exponential backoff, then falls to the next provider. If all providers fail, returns `503 Service Unavailable`.

Embeddings always use OpenAI (`text-embedding-ada-002`) since Claude and Gemini do not expose embedding APIs.
