/**
 * k6 Load Test: Content Generation Pipeline
 *
 * Simulates concurrent content generation requests under production load.
 *
 * Scenarios:
 *   - baseline:   10 VUs for 1m  → validates normal throughput
 *   - stress:     50 VUs for 3m  → validates queue backpressure
 *   - spike:      100 VUs for 30s → validates system stability under burst
 *
 * Run:
 *   k6 run --env BASE_URL=http://localhost:3000 test/load/content-pipeline.k6.js
 *   k6 run --env BASE_URL=http://localhost:3000 --scenario stress test/load/content-pipeline.k6.js
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────
const errorRate           = new Rate('error_rate');
const jobQueueLatency     = new Trend('job_queue_latency_ms',     true);
const jobCompletionTime   = new Trend('job_completion_time_ms',   true);
const queueRejectRate     = new Rate('queue_reject_rate');
const jobsCreated         = new Counter('jobs_created_total');

// ── Thresholds (stability targets) ─────────────────────────────────────────
export const options = {
  scenarios: {
    baseline: {
      executor: 'constant-vus',
      vus: 10,
      duration: '1m',
      tags: { scenario: 'baseline' },
    },
    stress: {
      executor: 'constant-vus',
      vus: 50,
      duration: '3m',
      startTime: '1m30s',
      tags: { scenario: 'stress' },
    },
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 100 },
        { duration: '20s', target: 100 },
        { duration: '10s', target: 0   },
      ],
      startTime: '5m',
      tags: { scenario: 'spike' },
    },
  },
  thresholds: {
    // Error rate < 1% across all scenarios (invariant)
    'error_rate': ['rate<0.01'],
    // p99 queue acceptance latency < 500ms
    'job_queue_latency_ms': ['p(99)<500'],
    // p95 HTTP errors (503) < 5%
    'queue_reject_rate': ['rate<0.05'],
    // Overall HTTP failure rate < 2%
    'http_req_failed': ['rate<0.02'],
  },
};

const BASE_URL  = __ENV.BASE_URL  || 'http://localhost:3000';
const BRAND_ID  = __ENV.BRAND_ID  || 'your-brand-id-here';
const API_TOKEN = __ENV.API_TOKEN || '';

const HEADERS = {
  'Content-Type': 'application/json',
  ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
};

const CONTENT_TYPES = ['BLOG', 'SOCIAL', 'EMAIL', 'LANDING_PAGE'];
const TOPICS = [
  'Introduction to Vector Databases',
  'Building RAG Pipelines with NestJS',
  'LLM Cost Optimisation Strategies',
  'Multi-tenant SaaS Architecture',
  'Semantic Search at Scale',
];

export default function () {
  const topic       = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const contentType = CONTENT_TYPES[Math.floor(Math.random() * CONTENT_TYPES.length)];

  // ── Step 1: Enqueue a content generation job ─────────────────────────────
  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/api/v1/brands/${BRAND_ID}/content/generate`,
    JSON.stringify({ topic, contentType }),
    { headers: HEADERS, timeout: '10s' },
  );
  const queueMs = Date.now() - start;

  jobQueueLatency.add(queueMs);

  const enqueueOk = check(res, {
    'enqueue status is 201': (r) => r.status === 201,
    'response has jobId':    (r) => {
      try { return !!JSON.parse(r.body).id; } catch { return false; }
    },
  });

  errorRate.add(!enqueueOk);

  if (res.status === 503 || res.status === 429) {
    queueRejectRate.add(1);
    sleep(1);
    return;
  }

  queueRejectRate.add(0);

  if (!enqueueOk) {
    sleep(0.5);
    return;
  }

  jobsCreated.add(1);

  let jobId;
  try {
    jobId = JSON.parse(res.body).id;
  } catch {
    sleep(0.5);
    return;
  }

  // ── Step 2: Poll for job completion (max 30 polls × 2s = 60s) ─────────────
  const pollStart = Date.now();
  let completed = false;

  for (let i = 0; i < 30; i++) {
    sleep(2);

    const pollRes = http.get(
      `${BASE_URL}/api/v1/brands/${BRAND_ID}/content/${jobId}`,
      { headers: HEADERS, timeout: '5s' },
    );

    if (pollRes.status !== 200) break;

    let job;
    try { job = JSON.parse(pollRes.body); } catch { break; }

    if (job.status === 'DONE' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      completed = true;
      const completionMs = Date.now() - pollStart;
      jobCompletionTime.add(completionMs);

      check(pollRes, {
        'job completed successfully': () => job.status === 'DONE',
        'result has content':         () => job.result !== null,
      });
      break;
    }
  }

  if (!completed) {
    errorRate.add(1);
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'test/load/reports/content-pipeline-summary.json': JSON.stringify(data, null, 2),
  };
}
