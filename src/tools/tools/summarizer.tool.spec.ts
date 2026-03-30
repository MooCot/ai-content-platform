import { SummarizerTool } from './summarizer.tool';
import { LLMRouterService } from '../../llm/llm-router.service';
import { LLMProvider } from '../../common/types/domain.types';

const VALID_SUMMARY_RESULT = {
  summary: 'Vector databases store high-dimensional embeddings for semantic search.',
  keyPoints: ['Fast ANN search', 'Scalable indexing', 'Multi-modal support'],
  tldr: 'Vector databases power modern AI search.',
};

describe('SummarizerTool', () => {
  let tool: SummarizerTool;
  let llmRouter: jest.Mocked<LLMRouterService>;

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(VALID_SUMMARY_RESULT),
    } as unknown as jest.Mocked<LLMRouterService>;

    tool = new SummarizerTool(llmRouter);
  });

  // ── Metadata ─────────────────────────────────────────────────────────────

  it('has the correct tool name', () => {
    expect(tool.name).toBe('summarizer');
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns success: true with the LLM result', async () => {
    const output = await tool.execute({ content: 'Long article content goes here.' });
    expect(output.success).toBe(true);
    expect(output.result).toEqual(VALID_SUMMARY_RESULT);
  });

  it('passes the content in the LLM message', async () => {
    await tool.execute({ content: 'Specific article content' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('Specific article content');
  });

  it('uses the provided maxLength in the message', async () => {
    await tool.execute({ content: 'content', maxLength: 200 });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('200');
    expect(req.systemPrompt).toContain('200');
  });

  it('defaults maxLength to 150 when not provided', async () => {
    await tool.execute({ content: 'content' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('150');
    expect(req.systemPrompt).toContain('150');
  });

  it('calls completeStructured with Claude as preferred provider', async () => {
    await tool.execute({ content: 'test' });
    const [, , options] = llmRouter.completeStructured.mock.calls[0];
    expect(options?.preferredProvider).toBe(LLMProvider.CLAUDE);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns success: false when LLM throws (does not propagate)', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('model unavailable'));
    const output = await tool.execute({ content: 'test' });
    expect(output.success).toBe(false);
    expect(output.result).toBeNull();
  });

  it('captures the error string in output.error', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('429 rate limit'));
    const output = await tool.execute({ content: 'test' });
    expect(output.error).toContain('429 rate limit');
  });

  it('never throws — always returns a ToolOutput', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('fatal'));
    await expect(tool.execute({ content: 'test' })).resolves.toBeDefined();
  });
});
