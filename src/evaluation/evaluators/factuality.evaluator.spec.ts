import { FactualityEvaluator } from './factuality.evaluator';
import { LLMRouterService } from '../../llm/llm-router.service';
import { SearchResult } from '../../common/types/domain.types';

function makeChunk(content: string, score = 0.9): SearchResult {
  return {
    chunkId: `chunk-${Math.random()}`,
    content,
    score,
    metadata: {
      documentId: 'doc-1',
      brandId: 'brand-1',
      filename: 'source.pdf',
      chunkIndex: 0,
    },
  };
}

describe('FactualityEvaluator', () => {
  let evaluator: FactualityEvaluator;
  let llmRouter: jest.Mocked<Pick<LLMRouterService, 'completeStructured'>>;

  const VALID_RESULT = {
    score: 0.8,
    supportedClaims: 8,
    totalClaims: 10,
    unsupportedClaims: ['claim A', 'claim B'],
  };

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(VALID_RESULT),
    } as unknown as jest.Mocked<Pick<LLMRouterService, 'completeStructured'>>;

    evaluator = new FactualityEvaluator(llmRouter as unknown as LLMRouterService);
  });

  // ── Empty RAG context (fast path) ─────────────────────────────────────────

  it('returns neutral score without calling LLM when ragContext is empty', async () => {
    const result = await evaluator.score('content', []);
    expect(llmRouter.completeStructured).not.toHaveBeenCalled();
    expect(result.score).toBe(0.5);
    expect(result.supportedClaims).toBe(0);
    expect(result.totalClaims).toBe(0);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns score, supportedClaims, totalClaims from LLM result', async () => {
    const result = await evaluator.score('content here', [makeChunk('source text')]);
    expect(result.score).toBe(0.8);
    expect(result.supportedClaims).toBe(8);
    expect(result.totalClaims).toBe(10);
  });

  it('calls LLM with the content excerpt in the message', async () => {
    const content = 'Factual content to verify.';
    await evaluator.score(content, [makeChunk('source')]);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain(content);
  });

  it('includes chunk content in the sources section', async () => {
    const chunk = makeChunk('Important fact about the topic.');
    await evaluator.score('content', [chunk]);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('Important fact about the topic.');
  });

  it('uses at most the top 5 chunks regardless of how many are provided', async () => {
    const chunks = Array.from({ length: 8 }, (_, i) => makeChunk(`Chunk content ${i}`));
    await evaluator.score('content', chunks);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    const prompt = req.messages[0].content as string;
    // Only [1] through [5] should appear, not [6], [7], [8]
    expect(prompt).toContain('[1]');
    expect(prompt).toContain('[5]');
    expect(prompt).not.toContain('[6]');
  });

  it('truncates chunk content to 400 characters per chunk', async () => {
    const longChunk = makeChunk('y'.repeat(600));
    await evaluator.score('content', [longChunk]);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    const prompt = req.messages[0].content as string;
    // The chunk should be truncated — 600 chars of 'y' should not appear
    expect(prompt).not.toContain('y'.repeat(401));
  });

  it('truncates content longer than 1500 characters', async () => {
    const longContent = 'z'.repeat(3000);
    await evaluator.score(longContent, [makeChunk('source')]);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    const prompt = req.messages[0].content as string;
    // Slice to 1500 means the 1501st char is not in prompt; first 1500 are present
    expect(prompt).not.toContain('z'.repeat(1501));
    expect(prompt).toContain('z'.repeat(1500));
  });

  it('passes a systemPrompt to the LLM', async () => {
    await evaluator.score('content', [makeChunk('source')]);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.systemPrompt).toBeDefined();
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns neutral fallback when LLM throws', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('LLM timeout'));
    const result = await evaluator.score('content', [makeChunk('source')]);
    expect(result.score).toBe(0.5);
    expect(result.supportedClaims).toBe(0);
    expect(result.totalClaims).toBe(0);
  });

  it('never throws — always resolves', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('fatal'));
    await expect(evaluator.score('content', [makeChunk('source')])).resolves.toBeDefined();
  });
});
