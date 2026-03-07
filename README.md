# Multi-Brand AI Content Platform

Production-grade AI content generation platform built with NestJS, featuring multi-tenant RAG, agent pipelines, multi-LLM routing, and real-time SSE streaming.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     HTTP API  (NestJS)                          │
│  /brands  │  /brands/:id/rag  │  /brands/:id/content  │ /stream │
└─────┬─────┴────────┬──────────┴──────────┬────────────┴────┬────┘
      │              │                     │                 │
      ▼              ▼                     ▼                 ▼
┌──────────┐  ┌───────────┐  ┌─────────────────────┐  ┌──────────┐
│  Brands  │  │    RAG    │  │   Content / Agents  │  │Streaming │
│  Module  │  │  Module   │  │       Module        │  │  Module  │
└────┬─────┘  └─────┬─────┘  └──────────┬──────────┘  └──────────┘
     │               │                  │
     └───────────────┼──────────────────┘
                     ▼
          ┌─────────────────────┐
          │     LLM Router      │
          │ Claude│OpenAI│Gemini│
          │  retry + fallback   │
          └─────────┬───────────┘
                    │
          ┌─────────▼───────────┐
          │   Infrastructure    │
          │ PostgreSQL │ Qdrant │
          └─────────────────────┘
```

### Agent Pipeline

```
POST /brands/:id/content/generate
          │
          ▼
    PlannerAgent        ← Claude (structured JSON)
    (outline, queries, tone)
          │
          ▼
    ResearcherAgent     ← Qdrant semantic search (parallel queries)
    (RAG context, citations)
          │
          ▼
    GeneratorAgent      ← Claude (streaming → SSE tokens)
    (draft content)
          │
          ▼
    OptimizerAgent      ← OpenAI + SEO/Tone tools
    (optimized content, keywords)
          │
          ▼
    QAAgent             ← Claude + Readability tool
    (final content, quality score)
          │
          ▼
    SSE: job_done event
```

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 + TypeScript strict |
| Database | PostgreSQL 16 (TypeORM) |
| Vector DB | Qdrant 1.9 |
| LLM providers | OpenAI (GPT-4o), Claude (claude-sonnet-4-6), Gemini 1.5 Pro |
| Streaming | Server-Sent Events (SSE) |
| Validation | class-validator + Zod (structured LLM output) |

## Quick Start

```bash
# 1. Copy environment
cp .env.example .env
# Fill in OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_AI_API_KEY

# 2. Start infrastructure
docker-compose up -d postgres qdrant

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
| `POST` | `/api/v1/brands/:brandId/content/generate` | Start content job |
| `GET` | `/api/v1/brands/:brandId/content` | List jobs |
| `GET` | `/api/v1/brands/:brandId/content/:jobId` | Get job + result |

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

## LLM Fallback Chain

Configured via `LLM_FALLBACK_CHAIN=claude,openai,gemini`. On 429/rate-limit/503 the router retries up to `LLM_MAX_RETRIES` times with exponential backoff, then falls to the next provider. If all providers fail, returns `503 Service Unavailable`.

Embeddings always use OpenAI (`text-embedding-ada-002`) since Claude and Gemini do not expose embedding APIs.
