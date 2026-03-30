import { SeoKeywordTool } from './seo-keyword.tool';
import { LLMRouterService } from '../../llm/llm-router.service';
import { LLMProvider } from '../../common/types/domain.types';

const VALID_SEO_RESULT = {
  primaryKeyword: 'vector database',
  secondaryKeywords: ['embeddings', 'semantic search', 'ANN index'],
  longTailKeywords: ['how to use vector database', 'vector database for AI'],
  searchIntent: 'informational' as const,
  suggestedTitle: 'Vector Databases: The Complete Guide',
  metaDescription:
    'Learn everything about vector databases and semantic search in this comprehensive guide.',
};

describe('SeoKeywordTool', () => {
  let tool: SeoKeywordTool;
  let llmRouter: jest.Mocked<LLMRouterService>;

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(VALID_SEO_RESULT),
    } as unknown as jest.Mocked<LLMRouterService>;

    tool = new SeoKeywordTool(llmRouter);
  });

  // ── Metadata ─────────────────────────────────────────────────────────────

  it('has the correct tool name', () => {
    expect(tool.name).toBe('seo_keyword_extractor');
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns success: true with the LLM result', async () => {
    const output = await tool.execute({ content: 'Content about vector databases.' });
    expect(output.success).toBe(true);
    expect(output.result).toEqual(VALID_SEO_RESULT);
  });

  it('calls completeStructured with the content in the message', async () => {
    await tool.execute({ content: 'Test content' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('Test content');
  });

  it('includes the topic in the message when provided', async () => {
    await tool.execute({ content: 'Some content', topic: 'Vector Databases' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('Vector Databases');
  });

  it('uses empty string for topic when not provided', async () => {
    await tool.execute({ content: 'Content without topic' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    // Should not throw — topic defaults to ''
    expect(req.messages[0].content).toContain('');
  });

  it('calls completeStructured with OpenAI as preferred provider', async () => {
    await tool.execute({ content: 'test' });
    const [, , options] = llmRouter.completeStructured.mock.calls[0];
    expect(options?.preferredProvider).toBe(LLMProvider.OPENAI);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns success: false when LLM throws (does not propagate)', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('LLM unavailable'));
    const output = await tool.execute({ content: 'test' });
    expect(output.success).toBe(false);
    expect(output.result).toBeNull();
  });

  it('includes the error message in the output on failure', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('rate limit'));
    const output = await tool.execute({ content: 'test' });
    expect(output.error).toContain('rate limit');
  });

  it('never throws — always returns a ToolOutput', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('fatal'));
    await expect(tool.execute({ content: 'test' })).resolves.toBeDefined();
  });
});
