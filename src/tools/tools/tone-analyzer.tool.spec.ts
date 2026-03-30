import { ToneAnalyzerTool } from './tone-analyzer.tool';
import { LLMRouterService } from '../../llm/llm-router.service';
import { LLMProvider, Tone } from '../../common/types/domain.types';

const VALID_TONE_RESULT = {
  detected: Tone.TECHNICAL,
  confidence: 0.87,
  scores: {
    [Tone.FORMAL]: 0.6,
    [Tone.CASUAL]: 0.1,
    [Tone.TECHNICAL]: 0.87,
    [Tone.FRIENDLY]: 0.2,
    [Tone.PERSUASIVE]: 0.3,
  },
  suggestions: ['Add more examples', 'Simplify jargon for wider audience'],
  alignedWithTarget: true,
};

describe('ToneAnalyzerTool', () => {
  let tool: ToneAnalyzerTool;
  let llmRouter: jest.Mocked<LLMRouterService>;

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(VALID_TONE_RESULT),
    } as unknown as jest.Mocked<LLMRouterService>;

    tool = new ToneAnalyzerTool(llmRouter);
  });

  // ── Metadata ─────────────────────────────────────────────────────────────

  it('has the correct tool name', () => {
    expect(tool.name).toBe('tone_analyzer');
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns success: true with the LLM result', async () => {
    const output = await tool.execute({ content: 'Technical content about databases.' });
    expect(output.success).toBe(true);
    expect(output.result).toEqual(VALID_TONE_RESULT);
  });

  it('passes the content in the LLM message', async () => {
    await tool.execute({ content: 'My unique content' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('My unique content');
  });

  it('includes the targetTone in the LLM message when provided', async () => {
    await tool.execute({ content: 'content', targetTone: Tone.CASUAL });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain(Tone.CASUAL);
  });

  it('defaults targetTone to FORMAL when not provided', async () => {
    await tool.execute({ content: 'content' });
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain(Tone.FORMAL);
  });

  it('calls completeStructured with OpenAI as preferred provider', async () => {
    await tool.execute({ content: 'test' });
    const [, , options] = llmRouter.completeStructured.mock.calls[0];
    expect(options?.preferredProvider).toBe(LLMProvider.OPENAI);
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns success: false when LLM throws (does not propagate)', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('timeout'));
    const output = await tool.execute({ content: 'test' });
    expect(output.success).toBe(false);
    expect(output.result).toBeNull();
  });

  it('captures the error string in output.error', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('503 overloaded'));
    const output = await tool.execute({ content: 'test' });
    expect(output.error).toContain('503 overloaded');
  });

  it('never throws — always returns a ToolOutput', async () => {
    llmRouter.completeStructured.mockRejectedValue(new TypeError('unexpected'));
    await expect(tool.execute({ content: 'test' })).resolves.toBeDefined();
  });
});
