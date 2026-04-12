# Multi-Brand AI Content Platform

Production-grade AI content generation platform built with NestJS, featuring multi-tenant RAG, agent pipelines, multi-LLM routing, and real-time SSE streaming.

**[API Docs →](https://moocot.github.io/ai-content-platform/)**

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

         ════════════════════════════════════════
              Contract Layer  (src/contracts/)
              Zod schemas enforced at every
              module boundary — queue, SSE,
              RAG results, agent outputs,
              evaluation records.
         ════════════════════════════════════════

         ════════════════════════════════════════
              Resilience Layer (src/resilience/)
              DegradedExecutionContext threaded
              through every pipeline run.
              System degrades quality, not
              availability.
         ════════════════════════════════════════
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
    OptimizerAgent  [optional] ← OpenAI + SEO/Tone tools
    (optimized content, keywords)
    ↑ skipped if degraded or latency budget exceeded
          │
          ▼
    QAAgent         [optional] ← Claude + Readability tool
    (final content, quality score)
    ↑ skipped if degraded or latency budget exceeded
          │
          ├─► SSE: job_done event  (result includes degraded + degradationReasons)
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
| Validation | class-validator + Zod (structured LLM output + contract layer) |
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

# 4. Open Swagger UI
open http://localhost:3000/docs

# 5. (Optional) Seed demo brands + upload knowledge-base documents
npm run seed

# 6. (Optional) Run end-to-end demo with live SSE output
npm run demo
```

## Demo

Two convenience scripts in `.scripts/` let you see the full pipeline running without Swagger or curl:

```bash
# Creates two demo brands (Acme Tech + Bright Bites) and uploads a knowledge-base
# document to each. Idempotent — safe to run multiple times.
npm run seed

# Full pipeline: create brand → wait for RAG indexing → generate a blog post → stream
# tokens to the terminal as they arrive from the LLM.
npm run demo
```

Both scripts accept an optional `BASE_URL` argument (default `http://localhost:3000`):

```bash
bash .scripts/demo.sh https://staging.content-platform.example.com
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

All events are validated against `SSEEventContractV1` before reaching the wire. Invalid events throw `ContractViolationException` and are never emitted.

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

## System Degradation Modes

The platform treats degradation as a **first-class system behavior** — availability is preserved even when individual components are slow or unavailable. A `DegradedExecutionContext` is attached to every pipeline run and accumulates reasons as they occur. The final `ContentResult` carries `degraded: boolean` and `degradationReasons: string[]` so clients can choose how to surface partial quality.

### Degradation reasons

| Reason | Trigger | Effect |
|---|---|---|
| `queue_overload` | BullMQ depth ≥ `QUEUE_DEPTH_THRESHOLD` (default 50) at job start | Optional agents skipped immediately |
| `rag_timeout` | RAG search exceeds `RAG_TIMEOUT_MS` (default 5 s) | Pipeline continues without retrieval context |
| `memory_timeout` | Episodic memory recall exceeds 200 ms | Pipeline continues without personalisation context |
| `llm_fallback` | LLM router switches to a non-preferred provider | Logged; pipeline continues |
| `contract_retry` | Optional agent output fails schema validation on first attempt | Agent retried once |
| `contract_violation` | One or more RAG chunks dropped at the contract boundary | Pipeline continues with partial retrieval context |
| `optional_agent_skipped` | Optional agent fails on both attempts, or pipeline already degraded | `optimized` falls back to `raw`; `finalContent` falls back through the chain |

### Optional vs required agents

| Agent | Required? | On failure |
|---|---|---|
| `PlannerAgent` | Yes | Job marked `FAILED` |
| `ResearcherAgent` | Yes | Job marked `FAILED` (RAG timeout is a soft fallback within the agent) |
| `GeneratorAgent` | Yes | Job marked `FAILED` |
| `OptimizerAgent` | **Optional** | Single retry → degraded continue |
| `QAAgent` | **Optional** | Single retry → degraded continue |

### Content fallbacks

When optional agents are skipped, the result is assembled from whatever was produced:

```
finalContent   = ctx.finalContent    (QA output)
             || ctx.optimizedContent (Optimizer output)
             || ctx.draftContent     (Generator output — always present)

optimized      = ctx.optimizedContent || ctx.draftContent
wordCount      = derived from finalContent
```

### Skip conditions

Optional agents are skipped when **either** condition holds:
- `ctx.degradation.isDegraded` — any prior reason was appended (queue overload, RAG timeout, etc.)
- `DegradationService.isLatencyBudgetExceeded(elapsed)` — wall time since pipeline start exceeds `PIPELINE_LATENCY_BUDGET_MS` (default 90 s)

### Degradation metrics

```
content_platform_degraded_total{reason="queue_overload"}
content_platform_degraded_total{reason="rag_timeout"}
content_platform_degraded_total{reason="memory_timeout"}
content_platform_degraded_total{reason="llm_fallback"}
content_platform_degraded_total{reason="contract_retry"}
content_platform_degraded_total{reason="contract_violation"}
content_platform_degraded_total{reason="optional_agent_skipped"}
```

Each label is incremented once per pipeline run where that reason occurred. The ratio of degraded pipelines can be derived by summing over reasons and dividing by `content_platform_pipeline_latency_ms_count`.

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `QUEUE_DEPTH_THRESHOLD` | `50` | BullMQ waiting+active jobs that triggers overload |
| `RAG_TIMEOUT_MS` | `5000` | Vector search timeout before `rag_timeout` fires |
| `PIPELINE_LATENCY_BUDGET_MS` | `90000` | Optional agents skipped after this many ms |
| `LLM_CB_FAILURE_THRESHOLD` | `5` | Consecutive provider failures before circuit opens |
| `LLM_CB_COOLDOWN_MS` | `30000` | ms circuit stays OPEN before allowing a test request |

---

## Contract Layer

The system uses a versioned, runtime-validated contract layer (`src/contracts/`) that enforces strict boundaries at every module boundary. Data that does not conform to a contract never enters system state.

### Domains

| Domain | Contract | Location |
|---|---|---|
| Agent inputs/outputs | `PlannerInput/OutputContractV1`, `ResearcherInput/OutputContractV1`, etc. | `contracts/v1/agents/` |
| Queue job payload | `ContentGenerationJobContractV1` | `contracts/v1/queue/` |
| Pipeline result | `ContentResultContractV1` | `contracts/v1/queue/` |
| SSE events | `SSEEventContractV1` (discriminated union) | `contracts/v1/events/` |
| RAG results | `RetrievalResultContractV1`, `DocumentChunkContractV1` | `contracts/v1/rag/` |
| Evaluation records | `EvaluationResultContractV1` | `contracts/v1/evaluation/` |

### Enforcement modes

| Mode | Used at | On violation |
|---|---|---|
| Hard reject | `QueueService.enqueue()`, `StreamingService.emit()`, `AgentOrchestratorService.run()` | Throws `ContractViolationException` (HTTP 422) |
| Soft filter | `RAGService.search()` results | Drops invalid items, logs warning |
| Soft exit | `EvaluationService.evaluate()` before DB save | Logs error, exits without persisting |

### Schema evolution

Contracts are **append-only**. To change a schema:

1. Add `src/contracts/v2/<domain>/<name>.contract.ts`
2. Export from `src/contracts/index.ts` alongside v1
3. Dispatch on `_contractVersion` in the consumer
4. Mark the v1 export `@deprecated` — remove only after all producers migrate

`ContractRegistryService` (`@Global`) provides `validate()`, `validateSafe()`, and `filterValid()` for use anywhere in the application via DI. Schemas can also be imported directly without DI for pure validation.

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

### invariants tested

| Invariant | Test location |
|---|---|
| Agent pipeline order: PLANNER → RESEARCHER → GENERATOR → OPTIMIZER → QA | `agent-orchestrator.service.spec.ts` |
| Optional agents skipped when degraded; all 5 run on a clean pipeline | `agent-orchestrator.service.spec.ts` |
| Brand isolation in DB queries and Qdrant collections | `rag.service.spec.ts`, `content.service.spec.ts`, `content-generation.e2e-spec.ts` |
| RAG brand isolation enforced at contract layer — mismatched chunks dropped | `rag.service.spec.ts` |
| RAG status machine: PENDING → CHUNKING → EMBEDDING → READY | `rag-pipeline.spec.ts` |
| Job status machine: QUEUED → RUNNING → DONE\|FAILED\|CANCELLED\|RETRYING | `content-pipeline.spec.ts`, `content-pipeline.processor.spec.ts` |
| Memory quality gate: `embedAndIndex()` only when composite ≥ 0.70 | `evaluation.service.spec.ts` |
| Evaluation is fire-and-forget: `evaluate()` never throws | `evaluation.service.spec.ts` |
| Embeddings only via OpenAI provider | `llm-router.service.spec.ts` |
| Composite score ≥ threshold for every golden entry | `prompt-regression.spec.ts` |

---

## CI/CD

### Pipeline

Two independent GitHub Actions workflows.

**`ci.yml`** — triggers on every push and on PRs targeting `main`:

```
install
   ├── lint            (parallel)
   ├── typecheck       (parallel)
   └── test:unit       (coverage artifact)
        └── test:integration
              └── test:e2e
```

**`deploy.yml`** — triggers only on push to `main`:

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
  - `content_platform_degraded_total{reason}` — degradation event counts by reason
- **Correlation IDs**: `X-Correlation-ID` header is generated (or passed through) on every request, propagated to queue jobs, agent context, and SSE events.

## LLM Fallback Chain

Configured via `LLM_FALLBACK_CHAIN=claude,openai,gemini`. On 429/rate-limit/503 the router retries up to `LLM_MAX_RETRIES` times with exponential backoff, then falls to the next provider. If all providers fail, returns `503 Service Unavailable`.

### Circuit breaker

Each provider has an independent circuit breaker (`CLOSED → OPEN → HALF_OPEN`):

- **CLOSED** — normal operation; failures are counted per consecutive run
- **OPEN** — provider is skipped immediately (no retries wasted); entered after `LLM_CB_FAILURE_THRESHOLD` consecutive failures
- **HALF_OPEN** — one test request is allowed after `LLM_CB_COOLDOWN_MS`; success resets to CLOSED, failure reopens

When a circuit is OPEN the router skips that provider and moves to the next in the fallback chain. `onFallback` is still triggered so the pipeline records a `llm_fallback` degradation reason. Use `LLMRouterService.getCircuitState(provider)` to expose circuit states in a health endpoint.

Embeddings always use OpenAI (`text-embedding-ada-002`) since Claude and Gemini do not expose embedding APIs.

---

## Known limitations

These are conscious trade-offs made for a pet-project scope. Each one has a known production solution.

- **`AgentContext` mutations are not atomic** — agents write to shared mutable state sequentially; a partial write on agent failure leaves the context in an inconsistent state. The production fix is an immutable snapshot pattern: each agent returns a new context object rather than mutating the shared one.

- **No circuit breaker on `EvaluationService`** — evaluation failures are silently swallowed (fire-and-forget by design), but if the scoring provider is down for an extended period the episodic memory quality gate never fires and Qdrant memory stagnates. A dead-letter queue + circuit breaker on the evaluation path would surface this.

- **RAG brand isolation uses soft filtering** — chunks with a mismatched `brandId` are dropped at the contract layer and logged, but the violation is not escalated beyond a warning. In a true multi-tenant production system this should be a hard error with an incident alert, since any bypass would constitute a cross-tenant data leak.

- **No per-brand SLA budgets** — all brands share the same agent timeouts (`PLANNER: 30 s`, `GENERATOR: 120 s`, etc.) regardless of corpus size or content type. Brand configuration could carry custom latency budgets so a brand with a large document corpus is not degraded on the same threshold as one with an empty index.
