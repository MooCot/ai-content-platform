import { DegradationService } from './degradation.service';
import { createMockConfigService } from '../../test/utils/mock-config.service';

function makeService(overrides: Record<string, unknown> = {}): DegradationService {
  return new DegradationService(createMockConfigService(overrides));
}

describe('DegradationService', () => {
  // ── Default config ────────────────────────────────────────────────────────
  // Default values from configuration.ts:
  //   queueDepthThreshold = 50
  //   ragTimeoutMs        = 5000
  //   latencyBudgetMs     = 90000

  describe('isQueueOverloaded()', () => {
    it('returns false when depth is below threshold', () => {
      const svc = makeService();
      expect(svc.isQueueOverloaded(0)).toBe(false);
      expect(svc.isQueueOverloaded(49)).toBe(false);
    });

    it('returns true when depth exactly meets threshold (boundary)', () => {
      const svc = makeService();
      expect(svc.isQueueOverloaded(50)).toBe(true);
    });

    it('returns true when depth exceeds threshold', () => {
      const svc = makeService();
      expect(svc.isQueueOverloaded(51)).toBe(true);
      expect(svc.isQueueOverloaded(1000)).toBe(true);
    });

    it('respects a custom threshold from config', () => {
      const svc = makeService({ 'resilience.queueDepthThreshold': 10 });
      expect(svc.isQueueOverloaded(9)).toBe(false);
      expect(svc.isQueueOverloaded(10)).toBe(true);
      expect(svc.isQueueOverloaded(11)).toBe(true);
    });

    it('returns false for zero depth regardless of threshold', () => {
      const svc = makeService({ 'resilience.queueDepthThreshold': 1 });
      expect(svc.isQueueOverloaded(0)).toBe(false);
    });
  });

  describe('isLatencyBudgetExceeded()', () => {
    it('returns false when elapsed is below the budget', () => {
      const svc = makeService();
      expect(svc.isLatencyBudgetExceeded(0)).toBe(false);
      expect(svc.isLatencyBudgetExceeded(89_999)).toBe(false);
    });

    it('returns true when elapsed exactly meets the budget (boundary)', () => {
      const svc = makeService();
      expect(svc.isLatencyBudgetExceeded(90_000)).toBe(true);
    });

    it('returns true when elapsed exceeds the budget', () => {
      const svc = makeService();
      expect(svc.isLatencyBudgetExceeded(90_001)).toBe(true);
      expect(svc.isLatencyBudgetExceeded(300_000)).toBe(true);
    });

    it('respects a custom latency budget from config', () => {
      const svc = makeService({ 'resilience.latencyBudgetMs': 5_000 });
      expect(svc.isLatencyBudgetExceeded(4_999)).toBe(false);
      expect(svc.isLatencyBudgetExceeded(5_000)).toBe(true);
    });
  });

  describe('ragTimeout getter', () => {
    it('returns the default RAG timeout', () => {
      const svc = makeService();
      expect(svc.ragTimeout).toBe(5_000);
    });

    it('returns a custom RAG timeout from config', () => {
      const svc = makeService({ 'resilience.ragTimeoutMs': 2_000 });
      expect(svc.ragTimeout).toBe(2_000);
    });

    it('is a positive number', () => {
      const svc = makeService();
      expect(svc.ragTimeout).toBeGreaterThan(0);
    });
  });

  describe('threshold boundary consistency', () => {
    it('queue threshold: depth = threshold - 1 is not overloaded', () => {
      const threshold = 25;
      const svc = makeService({ 'resilience.queueDepthThreshold': threshold });
      expect(svc.isQueueOverloaded(threshold - 1)).toBe(false);
    });

    it('latency budget: elapsed = budget - 1 is not exceeded', () => {
      const budget = 60_000;
      const svc = makeService({ 'resilience.latencyBudgetMs': budget });
      expect(svc.isLatencyBudgetExceeded(budget - 1)).toBe(false);
    });
  });
});
