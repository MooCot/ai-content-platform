import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    // Each instance owns its own Registry — no global state conflicts
    service = new MetricsService();
  });

  // ── API surface: methods do not throw ─────────────────────────────────────

  it('recordTokenUsage does not throw', () => {
    expect(() =>
      service.recordTokenUsage('claude', 'claude-sonnet-4-6', 'GENERATOR', 100, 200, 0.003),
    ).not.toThrow();
  });

  it('recordLlmLatency does not throw', () => {
    expect(() => service.recordLlmLatency('openai', 'gpt-4o', 'PLANNER', 1250)).not.toThrow();
  });

  it('recordLlmError does not throw', () => {
    expect(() => service.recordLlmError('gemini', 'timeout')).not.toThrow();
  });

  it('recordPipelineLatency does not throw', () => {
    expect(() => service.recordPipelineLatency('BLOG', 45000)).not.toThrow();
  });

  it('recordAgentLatency does not throw', () => {
    expect(() => service.recordAgentLatency('GENERATOR', 'BLOG', 3000)).not.toThrow();
  });

  it('setQueueDepth does not throw', () => {
    expect(() => service.setQueueDepth(42)).not.toThrow();
  });

  it('recordQueueWaitTime does not throw', () => {
    expect(() => service.recordQueueWaitTime(5000)).not.toThrow();
  });

  it('recordEvaluationScore does not throw', () => {
    expect(() =>
      service.recordEvaluationScore('brand-1', 'BLOG', 'claude-sonnet-4-6', 0.85),
    ).not.toThrow();
  });

  it('recordDegradation does not throw', () => {
    expect(() => service.recordDegradation('rag_timeout')).not.toThrow();
    expect(() => service.recordDegradation('queue_overload')).not.toThrow();
    expect(() => service.recordDegradation('optional_agent_skipped')).not.toThrow();
  });

  // ── getMetrics() returns Prometheus exposition format ─────────────────────

  it('getMetrics() resolves to a non-empty string', async () => {
    const output = await service.getMetrics();
    expect(typeof output).toBe('string');
  });

  it('getMetrics() output contains registered metric names', async () => {
    const output = await service.getMetrics();
    expect(output).toContain('content_platform_llm_tokens_total');
    expect(output).toContain('content_platform_queue_depth');
    expect(output).toContain('content_platform_degraded_total');
    expect(output).toContain('content_platform_evaluation_score');
  });

  it('getMetrics() reflects recorded values', async () => {
    service.setQueueDepth(17);
    const output = await service.getMetrics();
    expect(output).toContain('17');
  });
});
