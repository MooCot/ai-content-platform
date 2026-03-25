/** All reasons a pipeline execution may enter degraded mode. */
export type DegradationReason =
  | 'rag_timeout'
  | 'llm_fallback'
  | 'queue_overload'
  | 'contract_retry'
  | 'optional_agent_skipped';

/**
 * Append-only record of degradation events for a single pipeline run.
 *
 * Threaded through AgentContext so any agent or service can contribute a
 * reason without breaking referential transparency — callers accumulate facts,
 * they do not set a global flag.
 *
 * Design invariants:
 *  - Each reason appears at most once (idempotent append).
 *  - The context is never reset mid-pipeline; degradation is monotonic.
 *  - `isDegraded` is derived from `reasons`, never set directly.
 */
export class DegradedExecutionContext {
  private readonly _reasons: DegradationReason[] = [];

  get isDegraded(): boolean {
    return this._reasons.length > 0;
  }

  /** Immutable snapshot — safe to spread or iterate without defensive copy. */
  get reasons(): readonly DegradationReason[] {
    return this._reasons as readonly DegradationReason[];
  }

  /** Idempotent: appending the same reason twice is a no-op. */
  append(reason: DegradationReason): void {
    if (!this._reasons.includes(reason)) {
      this._reasons.push(reason);
    }
  }
}
