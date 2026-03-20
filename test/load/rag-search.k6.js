/**
 * k6 Load Test: RAG Semantic Search
 *
 * Validates Qdrant vector search latency and throughput under concurrent load.
 *
 * Run:
 *   k6 run --env BASE_URL=http://localhost:3000 --env BRAND_ID=xxx test/load/rag-search.k6.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const searchLatency = new Trend('rag_search_latency_ms', true);
const errorRate     = new Rate('error_rate');

export const options = {
  scenarios: {
    normal: {
      executor: 'constant-vus',
      vus: 20,
      duration: '2m',
    },
    high: {
      executor: 'constant-vus',
      vus: 80,
      duration: '2m',
      startTime: '2m30s',
    },
  },
  thresholds: {
    'rag_search_latency_ms': ['p(95)<200', 'p(99)<500'],
    'error_rate': ['rate<0.01'],
    'http_req_failed': ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const BRAND_ID = __ENV.BRAND_ID || 'your-brand-id-here';
const HEADERS  = { 'Content-Type': 'application/json' };

const QUERIES = [
  'vector database embeddings',
  'semantic search RAG pipeline',
  'LLM cost optimization',
  'NestJS microservices',
  'PostgreSQL full text search',
  'Redis caching strategy',
  'OpenAI API rate limits',
];

export default function () {
  const query = QUERIES[Math.floor(Math.random() * QUERIES.length)];
  const encoded = encodeURIComponent(query);

  const start = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/brands/${BRAND_ID}/rag/search?query=${encoded}`,
    { headers: HEADERS, timeout: '5s' },
  );
  searchLatency.add(Date.now() - start);

  const ok = check(res, {
    'search returns 200':     (r) => r.status === 200,
    'response is array':      (r) => { try { return Array.isArray(JSON.parse(r.body)); } catch { return false; } },
  });

  errorRate.add(!ok);
  sleep(0.2);
}

export function handleSummary(data) {
  return {
    'test/load/reports/rag-search-summary.json': JSON.stringify(data, null, 2),
  };
}
