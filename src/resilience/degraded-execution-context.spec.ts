import { DegradedExecutionContext, DegradationReason } from './degraded-execution-context';

describe('DegradedExecutionContext', () => {
  let ctx: DegradedExecutionContext;

  beforeEach(() => {
    ctx = new DegradedExecutionContext();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts not degraded', () => {
    expect(ctx.isDegraded).toBe(false);
  });

  it('starts with an empty reasons list', () => {
    expect(ctx.reasons).toHaveLength(0);
  });

  // ── append() ──────────────────────────────────────────────────────────────

  it('becomes degraded after the first append', () => {
    ctx.append('rag_timeout');
    expect(ctx.isDegraded).toBe(true);
  });

  it('accumulates distinct reasons in insertion order', () => {
    ctx.append('rag_timeout');
    ctx.append('llm_fallback');
    ctx.append('queue_overload');

    expect(ctx.reasons).toEqual(['rag_timeout', 'llm_fallback', 'queue_overload']);
  });

  it('accepts every valid DegradationReason without throwing', () => {
    const allReasons: DegradationReason[] = [
      'rag_timeout',
      'llm_fallback',
      'queue_overload',
      'contract_retry',
      'optional_agent_skipped',
    ];
    for (const reason of allReasons) {
      expect(() => ctx.append(reason)).not.toThrow();
    }
    expect(ctx.reasons).toHaveLength(allReasons.length);
  });

  // ── Idempotency invariant ─────────────────────────────────────────────────

  it('does not duplicate a reason appended twice', () => {
    ctx.append('rag_timeout');
    ctx.append('rag_timeout');

    expect(ctx.reasons).toHaveLength(1);
    expect(ctx.reasons).toEqual(['rag_timeout']);
  });

  it('is idempotent for multiple duplicates across different reasons', () => {
    ctx.append('llm_fallback');
    ctx.append('contract_retry');
    ctx.append('llm_fallback'); // duplicate
    ctx.append('contract_retry'); // duplicate
    ctx.append('contract_retry'); // triplicate

    expect(ctx.reasons).toEqual(['llm_fallback', 'contract_retry']);
  });

  it('stays degraded after duplicate appends — monotonic, not toggling', () => {
    ctx.append('queue_overload');
    ctx.append('queue_overload');
    expect(ctx.isDegraded).toBe(true);
  });

  // ── Monotonicity invariant ────────────────────────────────────────────────

  it('never returns to non-degraded once degraded', () => {
    ctx.append('optional_agent_skipped');
    expect(ctx.isDegraded).toBe(true);

    // No reset mechanism exists — this just asserts the final state can't flip
    expect(ctx.isDegraded).toBe(true);
  });

  // ── Immutability of the reasons snapshot ─────────────────────────────────

  it('reasons getter returns the same reference on repeated calls', () => {
    ctx.append('rag_timeout');
    expect(ctx.reasons).toBe(ctx.reasons);
  });

  it('spread of reasons does not affect internal state', () => {
    ctx.append('rag_timeout');
    const snapshot = [...ctx.reasons];

    // Mutate the spread copy — should not affect the context
    (snapshot as string[]).push('llm_fallback');

    expect(ctx.reasons).toHaveLength(1);
    expect(ctx.reasons).toEqual(['rag_timeout']);
  });

  // ── isDegraded derives from reasons ──────────────────────────────────────

  it('isDegraded is true iff reasons is non-empty', () => {
    expect(ctx.isDegraded).toBe(ctx.reasons.length > 0);

    ctx.append('rag_timeout');
    expect(ctx.isDegraded).toBe(ctx.reasons.length > 0);

    ctx.append('llm_fallback');
    expect(ctx.isDegraded).toBe(ctx.reasons.length > 0);
  });
});
