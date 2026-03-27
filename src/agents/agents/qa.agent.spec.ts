import { QAAgent } from './qa.agent';
import { LLMRouterService } from '../../llm/llm-router.service';
import { ToolsRegistry } from '../../tools/tools.registry';
import { AgentContext } from '../context/agent-context';
import { AgentRole, ContentType, LLMProvider, Tone } from '../../common/types/domain.types';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';
import { ITool, ToolOutput } from '../../common/interfaces/tool.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(opts: { hasOptimized?: boolean } = {}): AgentContext {
  const brand = createBrandFixture();
  const ctx = new AgentContext({
    jobId: 'job-qa-1',
    brandId: brand.id,
    brandConfig: brand.config,
    topic: 'Vector Databases',
    contentType: ContentType.BLOG,
    correlationId: 'corr-qa-1',
  });
  ctx.draftContent = 'Draft content about vector databases.';
  ctx.optimizedContent =
    (opts.hasOptimized ?? true) ? 'Optimized content about vector databases at scale.' : '';
  ctx.targetTone = Tone.TECHNICAL;
  ctx.citations = ['intro.pdf'];
  return ctx;
}

function makeTool(name: string, result: unknown): jest.Mocked<ITool> {
  return {
    name,
    description: `Mock ${name}`,
    inputSchema: {},
    execute: jest.fn().mockResolvedValue({ success: true, result }),
  } as unknown as jest.Mocked<ITool>;
}

const DEFAULT_LLM_RESULT = {
  finalContent: 'Final reviewed content about vector databases at scale.',
  approved: true,
  issues: [],
  corrections: ['minor grammar fix'],
  qualityScore: 88,
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('QAAgent', () => {
  let llmRouter: jest.Mocked<LLMRouterService>;
  let tools: jest.Mocked<ToolsRegistry>;
  let agent: QAAgent;

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(DEFAULT_LLM_RESULT),
    } as unknown as jest.Mocked<LLMRouterService>;

    const readabilityTool = makeTool('readability_checker', { fleschReadingEase: 65 });
    tools = {
      get: jest.fn().mockReturnValue(readabilityTool),
    } as unknown as jest.Mocked<ToolsRegistry>;

    agent = new QAAgent(llmRouter, tools);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('populates ctx.finalContent from LLM response', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);
    expect(ctx.finalContent).toBe('Final reviewed content about vector databases at scale.');
  });

  it('sets ctx.approved from LLM response', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);
    expect(ctx.approved).toBe(true);
  });

  it('populates ctx.readabilityScore from readability tool', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);
    expect(ctx.readabilityScore).toBe(65);
  });

  it('calls readability_checker with the content', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    const readabilityTool = tools.get('readability_checker') as jest.Mocked<ITool>;
    expect(readabilityTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ content: ctx.optimizedContent }),
    );
  });

  it('calls LLM with Claude as preferred provider', async () => {
    await agent.run(makeCtx());
    expect(llmRouter.completeStructured).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ preferredProvider: LLMProvider.CLAUDE }),
    );
  });

  it('records an agent step with QA role', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.steps).toHaveLength(1);
    expect(ctx.steps[0].agent).toBe(AgentRole.QA);
    expect(ctx.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Content selection: optimized vs draft ─────────────────────────────

  it('uses optimizedContent when present', async () => {
    const ctx = makeCtx({ hasOptimized: true });
    await agent.run(ctx);

    // readability tool and LLM should receive optimizedContent
    const readabilityTool = tools.get('readability_checker') as jest.Mocked<ITool>;
    expect(readabilityTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Optimized content about vector databases at scale.' }),
    );
  });

  it('falls back to draftContent when optimizedContent is empty', async () => {
    const ctx = makeCtx({ hasOptimized: false });
    await agent.run(ctx);

    const readabilityTool = tools.get('readability_checker') as jest.Mocked<ITool>;
    expect(readabilityTool.execute).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Draft content about vector databases.' }),
    );
  });

  // ── Readability tool failure ────────────────────────────────────────────

  it('continues without readability score when tool returns success: false', async () => {
    const failingTool = makeTool('readability_checker', null);
    failingTool.execute.mockResolvedValue({ success: false, error: 'tool error' } as ToolOutput);
    tools.get.mockReturnValue(failingTool);

    const ctx = makeCtx();
    const originalScore = ctx.readabilityScore;
    await agent.run(ctx);

    // readabilityScore unchanged (stays at default 0)
    expect(ctx.readabilityScore).toBe(originalScore);
    // But LLM still ran
    expect(ctx.finalContent).toBe(DEFAULT_LLM_RESULT.finalContent);
  });

  it('omits readability context from prompt when tool fails', async () => {
    const failingTool = makeTool('readability_checker', null);
    failingTool.execute.mockResolvedValue({ success: false, error: 'tool error' } as ToolOutput);
    tools.get.mockReturnValue(failingTool);

    await agent.run(makeCtx());

    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).not.toContain('Readability score:');
  });

  // ── LLM fallback ────────────────────────────────────────────────────────

  it('appends llm_fallback to degradation when onFallback is triggered', async () => {
    llmRouter.completeStructured.mockImplementation((_req, _schema, options) => {
      options?.onFallback?.(LLMProvider.OPENAI);
      return Promise.resolve(DEFAULT_LLM_RESULT);
    });

    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.degradation.reasons).toContain('llm_fallback');
  });

  // ── Errors ──────────────────────────────────────────────────────────────

  it('propagates LLM errors', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('LLM down'));
    await expect(agent.run(makeCtx())).rejects.toThrow('LLM down');
  });

  // ── Cancellation ────────────────────────────────────────────────────────

  it('throws when context is cancelled before running', async () => {
    const ctx = makeCtx();
    ctx.cancel();
    await expect(agent.run(ctx)).rejects.toThrow('Pipeline cancelled');
    expect(llmRouter.completeStructured).not.toHaveBeenCalled();
  });
});
