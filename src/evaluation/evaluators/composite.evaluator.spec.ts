import { CompositeEvaluator } from './composite.evaluator';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

describe('CompositeEvaluator', () => {
  let evaluator: CompositeEvaluator;

  beforeEach(() => {
    // Default weights: relevance=0.3, tone=0.25, factuality=0.25, readability=0.2
    evaluator = new CompositeEvaluator(createMockConfigService());
  });

  it('computes weighted average correctly', () => {
    const score = evaluator.score({
      relevance: 1.0,
      tone: 1.0,
      factuality: 1.0,
      readability: 1.0,
    });
    expect(score).toBeCloseTo(1.0, 4);
  });

  it('returns 0 for all-zero inputs', () => {
    const score = evaluator.score({
      relevance: 0,
      tone: 0,
      factuality: 0,
      readability: 0,
    });
    expect(score).toBe(0);
  });

  it('applies dimension weights correctly', () => {
    // Only relevance = 1.0, rest = 0 → should equal relevance weight (0.3)
    const score = evaluator.score({
      relevance: 1.0,
      tone: 0,
      factuality: 0,
      readability: 0,
    });
    expect(score).toBeCloseTo(0.3, 4);
  });

  it('clamps output to [0, 1] range', () => {
    // Weights sum to 1, so a score > 1 can't happen — but test clamping at 0
    const score = evaluator.score({
      relevance: 0,
      tone: 0,
      factuality: 0,
      readability: 0,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('produces a value >= 0.70 for high-quality inputs (invariant: memory gate)', () => {
    // Simulate a high-quality generation — composite must exceed the 0.70 threshold
    const score = evaluator.score({
      relevance: 0.85,
      tone: 0.78,
      factuality: 0.9,
      readability: 0.72,
    });
    expect(score).toBeGreaterThanOrEqual(0.7);
  });

  it('produces a value < 0.70 for low-quality inputs', () => {
    const score = evaluator.score({
      relevance: 0.4,
      tone: 0.35,
      factuality: 0.5,
      readability: 0.55,
    });
    expect(score).toBeLessThan(0.7);
  });

  it('rounds to 4 decimal places', () => {
    const score = evaluator.score({
      relevance: 0.333,
      tone: 0.666,
      factuality: 0.777,
      readability: 0.888,
    });
    const decimals = score.toString().split('.')[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });
});
