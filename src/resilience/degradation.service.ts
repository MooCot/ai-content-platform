import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../common/config/configuration';

/**
 * Stateless service that encapsulates degradation threshold decisions.
 *
 * All thresholds are configurable via environment variables so they can be
 * tuned per environment without code changes. The service itself never mutates
 * pipeline state — callers receive a boolean decision and act on it.
 */
@Injectable()
export class DegradationService {
  private readonly queueDepthThreshold: number;
  private readonly ragTimeoutMs: number;
  private readonly latencyBudgetMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.queueDepthThreshold = config.get('resilience.queueDepthThreshold', { infer: true });
    this.ragTimeoutMs = config.get('resilience.ragTimeoutMs', { infer: true });
    this.latencyBudgetMs = config.get('resilience.latencyBudgetMs', { infer: true });
  }

  /** True when the number of waiting jobs meets or exceeds the overload threshold. */
  isQueueOverloaded(depth: number): boolean {
    return depth >= this.queueDepthThreshold;
  }

  /**
   * True when the pipeline has already consumed its latency budget.
   * Used by the orchestrator to decide whether to skip optional agents.
   */
  isLatencyBudgetExceeded(elapsedMs: number): boolean {
    return elapsedMs >= this.latencyBudgetMs;
  }

  /** Configurable RAG search timeout (ms). Agents use this for their Promise.race. */
  get ragTimeout(): number {
    return this.ragTimeoutMs;
  }
}
