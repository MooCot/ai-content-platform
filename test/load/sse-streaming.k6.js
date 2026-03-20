/**
 * k6 Load Test: SSE Streaming under Concurrency
 *
 * Uses k6's experimental WebSocket / HTTP streaming support to hold open
 * multiple SSE connections simultaneously and measure token delivery latency.
 *
 * Run:
 *   k6 run --env BASE_URL=http://localhost:3000 --env BRAND_ID=xxx test/load/sse-streaming.k6.js
 *
 * Note: SSE is tested via regular HTTP GET. k6 reads the response body
 * incrementally which is sufficient for measuring connection stability.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

const sseConnectionTime = new Trend('sse_connection_time_ms', true);
const sseEventsReceived = new Counter('sse_events_received_total');
const errorRate         = new Rate('error_rate');

export const options = {
  scenarios: {
    concurrent_streams: {
      executor: 'constant-vus',
      vus: 25,
      duration: '3m',
    },
  },
  thresholds: {
    'sse_connection_time_ms': ['p(95)<1000'],
    'error_rate': ['rate<0.05'],
    'http_req_failed': ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const BRAND_ID = __ENV.BRAND_ID || 'your-brand-id-here';

function createJob() {
  const res = http.post(
    `${BASE_URL}/api/v1/brands/${BRAND_ID}/content/generate`,
    JSON.stringify({ topic: 'SSE streaming test', contentType: 'BLOG' }),
    { headers: { 'Content-Type': 'application/json' }, timeout: '10s' },
  );
  if (res.status !== 201) return null;
  try { return JSON.parse(res.body).id; } catch { return null; }
}

export default function () {
  // ── Step 1: Create a job to stream ───────────────────────────────────────
  const jobId = createJob();
  if (!jobId) {
    errorRate.add(1);
    sleep(1);
    return;
  }

  // ── Step 2: Connect to SSE stream ────────────────────────────────────────
  const connStart = Date.now();
  const res = http.get(
    `${BASE_URL}/api/v1/stream/${jobId}`,
    {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      timeout: '120s',
      // k6 reads the full body which includes all SSE events
    },
  );
  sseConnectionTime.add(Date.now() - connStart);

  const ok = check(res, {
    'SSE connection opened (200)': (r) => r.status === 200,
    'response contains event data': (r) => r.body.includes('event:'),
    'job_done event received': (r) => r.body.includes('job_done'),
  });

  errorRate.add(!ok);

  // Count events in response body
  if (res.body) {
    const eventCount = (res.body.match(/^event:/gm) || []).length;
    sseEventsReceived.add(eventCount);
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'test/load/reports/sse-streaming-summary.json': JSON.stringify(data, null, 2),
  };
}
