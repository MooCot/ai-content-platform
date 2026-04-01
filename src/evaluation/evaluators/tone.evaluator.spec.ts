import { ToneEvaluator } from './tone.evaluator';
import { LLMRouterService } from '../../llm/llm-router.service';
import { Tone } from '../../common/types/domain.types';

describe('ToneEvaluator', () => {
  let evaluator: ToneEvaluator;
  let llmRouter: jest.Mocked<Pick<LLMRouterService, 'completeStructured'>>;

  const VALID_RESULT = { score: 0.85, detected: 'TECHNICAL', reasoning: 'Clear technical tone.' };

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(VALID_RESULT),
    } as unknown as jest.Mocked<Pick<LLMRouterService, 'completeStructured'>>;

    evaluator = new ToneEvaluator(llmRouter as unknown as LLMRouterService);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns score and detected from LLM result', async () => {
    const result = await evaluator.score(Tone.TECHNICAL, 'Content about system design.');
    expect(result.score).toBe(0.85);
    expect(result.detected).toBe('TECHNICAL');
  });

  it('passes the targetTone in the message', async () => {
    await evaluator.score(Tone.CASUAL, 'Some content.');
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain(Tone.CASUAL);
  });

  it('includes all available tones in the prompt', async () => {
    await evaluator.score(Tone.FORMAL, 'Content here.');
    const [req] = llmRouter.completeStructured.mock.calls[0];
    Object.values(Tone).forEach((tone) => {
      expect(req.messages[0].content).toContain(tone);
    });
  });

  it('truncates content longer than 1500 characters', async () => {
    const longContent = 'x'.repeat(3000);
    await evaluator.score(Tone.FORMAL, longContent);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    const prompt = req.messages[0].content as string;
    // Slice to 1500 means the 1501st char is not in prompt; first 1500 are present
    expect(prompt).not.toContain('x'.repeat(1501));
    expect(prompt).toContain('x'.repeat(1500));
  });

  it('does not truncate content shorter than 1500 characters', async () => {
    const shortContent = 'Short technical content.';
    await evaluator.score(Tone.TECHNICAL, shortContent);
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain(shortContent);
  });

  it('passes a systemPrompt to the LLM', async () => {
    await evaluator.score(Tone.FORMAL, 'content');
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.systemPrompt).toBeDefined();
    expect(typeof req.systemPrompt).toBe('string');
  });

  // ── Error handling ────────────────────────────────────────────────────────

  it('returns neutral score 0.5 and "UNKNOWN" when LLM throws', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('LLM unavailable'));
    const result = await evaluator.score(Tone.FORMAL, 'content');
    expect(result.score).toBe(0.5);
    expect(result.detected).toBe('UNKNOWN');
  });

  it('never throws — always resolves', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('fatal'));
    await expect(evaluator.score(Tone.PERSUASIVE, 'content')).resolves.toBeDefined();
  });
});
