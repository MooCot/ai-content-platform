import { Injectable, OnModuleInit } from '@nestjs/common';
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

const NS = 'content_platform'; // metric name namespace

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  // ── LLM ──────────────────────────────────────────────────────────────────────
  private readonly llmTokensTotal: Counter<string>;
  private readonly llmCostUsdTotal: Counter<string>;
  private readonly llmLatencyMs: Histogram<string>;
  private readonly llmErrorsTotal: Counter<string>;

  // ── Pipeline ─────────────────────────────────────────────────────────────────
  private readonly pipelineLatencyMs: Histogram<string>;
  private readonly agentLatencyMs: Histogram<string>;

  // ── Queue ────────────────────────────────────────────────────────────────────
  private readonly queueDepth: Gauge<string>;
  private readonly queueWaitTimeMs: Histogram<string>;

  // ── Evaluation ───────────────────────────────────────────────────────────────
  private readonly evaluationScore: Histogram<string>;

  // ── Resilience ───────────────────────────────────────────────────────────────
  private readonly degradedTotal: Counter<string>;

  constructor() {
    const reg = this.registry;

    this.llmTokensTotal = new Counter({
      name: `${NS}_llm_tokens_total`,
      help: 'Total LLM tokens consumed',
      labelNames: ['provider', 'model', 'agent', 'token_type'],
      registers: [reg],
    });

    this.llmCostUsdTotal = new Counter({
      name: `${NS}_llm_cost_usd_total`,
      help: 'Estimated LLM cost in USD',
      labelNames: ['provider', 'model'],
      registers: [reg],
    });

    this.llmLatencyMs = new Histogram({
      name: `${NS}_llm_latency_ms`,
      help: 'LLM call latency in milliseconds',
      labelNames: ['provider', 'model', 'agent'],
      buckets: [100, 500, 1000, 2000, 5000, 10000, 30000],
      registers: [reg],
    });

    this.llmErrorsTotal = new Counter({
      name: `${NS}_llm_errors_total`,
      help: 'Total LLM provider errors',
      labelNames: ['provider', 'error_type'],
      registers: [reg],
    });

    this.pipelineLatencyMs = new Histogram({
      name: `${NS}_pipeline_latency_ms`,
      help: 'End-to-end agent pipeline latency in milliseconds',
      labelNames: ['content_type'],
      buckets: [5000, 15000, 30000, 60000, 120000, 300000],
      registers: [reg],
    });

    this.agentLatencyMs = new Histogram({
      name: `${NS}_agent_latency_ms`,
      help: 'Per-agent step latency in milliseconds',
      labelNames: ['agent', 'content_type'],
      buckets: [500, 1000, 5000, 15000, 30000, 60000, 120000],
      registers: [reg],
    });

    this.queueDepth = new Gauge({
      name: `${NS}_queue_depth`,
      help: 'Current number of jobs in the content-pipeline queue',
      registers: [reg],
    });

    this.queueWaitTimeMs = new Histogram({
      name: `${NS}_queue_wait_time_ms`,
      help: 'Time a job spent waiting in the queue before processing',
      buckets: [500, 1000, 5000, 15000, 60000, 300000],
      registers: [reg],
    });

    this.evaluationScore = new Histogram({
      name: `${NS}_evaluation_score`,
      help: 'Composite quality evaluation score (0-1) per generation',
      labelNames: ['brand_id', 'content_type', 'model_id'],
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      registers: [reg],
    });

    this.degradedTotal = new Counter({
      name: `${NS}_degraded_total`,
      help: 'Total pipeline executions that entered degraded mode, labelled by reason',
      labelNames: ['reason'],
      registers: [reg],
    });
  }

  onModuleInit(): void {
    collectDefaultMetrics({ register: this.registry, prefix: `${NS}_node_` });
  }

  // ── Public recording API ──────────────────────────────────────────────────

  recordTokenUsage(
    provider: string,
    model: string,
    agent: string,
    promptTokens: number,
    completionTokens: number,
    costUsd: number,
  ): void {
    this.llmTokensTotal.inc({ provider, model, agent, token_type: 'prompt' }, promptTokens);
    this.llmTokensTotal.inc({ provider, model, agent, token_type: 'completion' }, completionTokens);
    this.llmCostUsdTotal.inc({ provider, model }, costUsd);
  }

  recordLlmLatency(provider: string, model: string, agent: string, durationMs: number): void {
    this.llmLatencyMs.observe({ provider, model, agent }, durationMs);
  }

  recordLlmError(provider: string, errorType: string): void {
    this.llmErrorsTotal.inc({ provider, error_type: errorType });
  }

  recordPipelineLatency(contentType: string, durationMs: number): void {
    this.pipelineLatencyMs.observe({ content_type: contentType }, durationMs);
  }

  recordAgentLatency(agent: string, contentType: string, durationMs: number): void {
    this.agentLatencyMs.observe({ agent, content_type: contentType }, durationMs);
  }

  setQueueDepth(depth: number): void {
    this.queueDepth.set(depth);
  }

  recordQueueWaitTime(waitMs: number): void {
    this.queueWaitTimeMs.observe(waitMs);
  }

  recordEvaluationScore(
    brandId: string,
    contentType: string,
    modelId: string,
    score: number,
  ): void {
    this.evaluationScore.observe(
      { brand_id: brandId, content_type: contentType, model_id: modelId },
      score,
    );
  }

  recordDegradation(reason: string): void {
    this.degradedTotal.inc({ reason });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
