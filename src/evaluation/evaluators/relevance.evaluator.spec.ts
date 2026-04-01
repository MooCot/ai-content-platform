import { RelevanceEvaluator } from './relevance.evaluator';
import { LLMRouterService } from '../../llm/llm-router.service';

describe('RelevanceEvaluator', () => {
  let evaluator: RelevanceEvaluator;
  let llmRouter: jest.Mocked<Pick<LLMRouterService, 'embed'>>;

  // Helper: unit vector of given length with all values = 1/sqrt(n)
  function unitVec(n: number): number[] {
    return Array(n).fill(1 / Math.sqrt(n));
  }

  beforeEach(() => {
    llmRouter = { embed: jest.fn() } as unknown as jest.Mocked<Pick<LLMRouterService, 'embed'>>;
    evaluator = new RelevanceEvaluator(llmRouter as unknown as LLMRouterService);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('calls embed with [topic, content]', async () => {
    llmRouter.embed.mockResolvedValue([unitVec(4), unitVec(4)]);
    await evaluator.score('AI trends', 'Content about AI.');
    expect(llmRouter.embed).toHaveBeenCalledWith(['AI trends', 'Content about AI.']);
  });

  it('returns a number in [0, 1]', async () => {
    llmRouter.embed.mockResolvedValue([unitVec(4), unitVec(4)]);
    const result = await evaluator.score('topic', 'content');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('returns ~1.0 for identical vectors (perfect relevance)', async () => {
    const vec = [0.6, 0.8, 0, 0];
    llmRouter.embed.mockResolvedValue([vec, vec]);
    const result = await evaluator.score('topic', 'content');
    expect(result).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors (no relevance)', async () => {
    // [1,0] ⊥ [0,1] → dot=0 → cosine=0
    llmRouter.embed.mockResolvedValue([
      [1, 0],
      [0, 1],
    ]);
    const result = await evaluator.score('topic', 'content');
    expect(result).toBe(0);
  });

  it('returns a value between 0 and 1 for partial similarity', async () => {
    // [1,1] and [1,0]: cosine = 1/sqrt(2) ≈ 0.707
    llmRouter.embed.mockResolvedValue([
      [1, 1],
      [1, 0],
    ]);
    const result = await evaluator.score('topic', 'content');
    expect(result).toBeCloseTo(1 / Math.sqrt(2), 5);
  });

  // ── Zero-magnitude edge cases ─────────────────────────────────────────────

  it('returns 0 when both vectors are zero magnitude', async () => {
    llmRouter.embed.mockResolvedValue([
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const result = await evaluator.score('topic', 'content');
    expect(result).toBe(0);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns neutral 0.5 when embed throws', async () => {
    llmRouter.embed.mockRejectedValue(new Error('embedding service unavailable'));
    const result = await evaluator.score('topic', 'content');
    expect(result).toBe(0.5);
  });

  it('never throws — always resolves', async () => {
    llmRouter.embed.mockRejectedValue(new Error('fatal'));
    await expect(evaluator.score('topic', 'content')).resolves.toBeDefined();
  });
});
