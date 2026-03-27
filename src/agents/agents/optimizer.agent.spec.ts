import { OptimizerAgent } from './optimizer.agent';
import { LLMRouterService } from '../../llm/llm-router.service';
import { ToolsRegistry } from '../../tools/tools.registry';
import { AgentContext } from '../context/agent-context';
import { AgentRole, ContentType, LLMProvider, Tone } from '../../common/types/domain.types';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';
import { ITool, ToolOutput } from '../../common/interfaces/tool.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): AgentContext {
  const brand = createBrandFixture();
  const ctx = new AgentContext({
    jobId: 'job-opt-1',
    brandId: brand.id,
    brandConfig: brand.config,
    topic: 'Vector Databases',
    contentType: ContentType.BLOG,
    correlationId: 'corr-opt-1',
  });
  ctx.draftContent = 'Vector databases are cool and powerful tools.';
  ctx.targetTone = Tone.TECHNICAL;
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

function makeTools(
  seoResult: unknown = {
    primaryKeyword: 'vector db',
    secondaryKeywords: ['embeddings', 'semantic search'],
    longTailKeywords: ['how to use vector database'],
  },
  toneResult: unknown = { detected: 'TECHNICAL', alignment: 0.9 },
): jest.Mocked<ToolsRegistry> {
  const seoTool = makeTool('seo_keyword_extractor', seoResult);
  const toneTool = makeTool('tone_analyzer', toneResult);

  return {
    get: jest.fn((name: string) => {
      if (name === 'seo_keyword_extractor') return seoTool;
      if (name === 'tone_analyzer') return toneTool;
      throw new Error(`Unknown tool: ${name}`);
    }),
  } as unknown as jest.Mocked<ToolsRegistry>;
}

const DEFAULT_LLM_RESULT = {
  optimizedContent: 'Vector databases are powerful tools for semantic search.',
  changesApplied: ['improved clarity', 'added SEO keywords'],
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('OptimizerAgent', () => {
  let llmRouter: jest.Mocked<LLMRouterService>;
  let tools: jest.Mocked<ToolsRegistry>;
  let agent: OptimizerAgent;

  beforeEach(() => {
    llmRouter = {
      completeStructured: jest.fn().mockResolvedValue(DEFAULT_LLM_RESULT),
    } as unknown as jest.Mocked<LLMRouterService>;

    tools = makeTools();
    agent = new OptimizerAgent(llmRouter, tools);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('populates ctx.optimizedContent from LLM response', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);
    expect(ctx.optimizedContent).toBe('Vector databases are powerful tools for semantic search.');
  });

  it('populates ctx.seoKeywords from SEO tool output', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);
    expect(ctx.seoKeywords).toEqual(
      expect.arrayContaining([
        'vector db',
        'embeddings',
        'semantic search',
        'how to use vector database',
      ]),
    );
  });

  it('calls LLM with OpenAI as preferred provider', async () => {
    await agent.run(makeCtx());
    expect(llmRouter.completeStructured).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ preferredProvider: LLMProvider.OPENAI }),
    );
  });

  it('calls both SEO and tone tools', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(tools.get).toHaveBeenCalledWith('seo_keyword_extractor');
    expect(tools.get).toHaveBeenCalledWith('tone_analyzer');
  });

  it('records an agent step with OPTIMIZER role', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.steps).toHaveLength(1);
    expect(ctx.steps[0].agent).toBe(AgentRole.OPTIMIZER);
    expect(ctx.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('passes the brand systemPrompt to the LLM request', async () => {
    await agent.run(makeCtx());
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.systemPrompt).toBe('You are a technical writer.');
  });

  // ── SEO tool failure ────────────────────────────────────────────────────

  it('continues without SEO keywords when SEO tool returns success: false', async () => {
    const seoTool = makeTool('seo_keyword_extractor', null);
    seoTool.execute.mockResolvedValue({ success: false, error: 'tool error' } as ToolOutput);
    const toneTool = makeTool('tone_analyzer', { detected: 'TECHNICAL' });

    const failingTools = {
      get: jest.fn((name: string) => {
        if (name === 'seo_keyword_extractor') return seoTool;
        return toneTool;
      }),
    } as unknown as jest.Mocked<ToolsRegistry>;

    agent = new OptimizerAgent(llmRouter, failingTools);
    const ctx = makeCtx();
    await agent.run(ctx);

    // Should still complete without SEO guidance
    expect(ctx.optimizedContent).toBe(DEFAULT_LLM_RESULT.optimizedContent);
    expect(ctx.seoKeywords).toEqual([]); // no keywords populated
  });

  it('continues without tone guidance when tone tool returns success: false', async () => {
    const seoTool = makeTool('seo_keyword_extractor', {
      primaryKeyword: 'kw',
      secondaryKeywords: [],
      longTailKeywords: [],
    });
    const toneTool = makeTool('tone_analyzer', null);
    toneTool.execute.mockResolvedValue({ success: false, error: 'tone error' } as ToolOutput);

    const partialTools = {
      get: jest.fn((name: string) => {
        if (name === 'seo_keyword_extractor') return seoTool;
        return toneTool;
      }),
    } as unknown as jest.Mocked<ToolsRegistry>;

    agent = new OptimizerAgent(llmRouter, partialTools);
    const ctx = makeCtx();
    await agent.run(ctx);

    // Should use fallback tone guidance
    const [req] = llmRouter.completeStructured.mock.calls[0];
    expect(req.messages[0].content).toContain('Ensure tone matches');
    expect(ctx.optimizedContent).toBe(DEFAULT_LLM_RESULT.optimizedContent);
  });

  // ── LLM fallback ────────────────────────────────────────────────────────

  it('appends llm_fallback to degradation when onFallback is triggered', async () => {
    llmRouter.completeStructured.mockImplementation((_req, _schema, options) => {
      options?.onFallback?.(LLMProvider.CLAUDE);
      return Promise.resolve(DEFAULT_LLM_RESULT);
    });

    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.degradation.reasons).toContain('llm_fallback');
  });

  // ── Errors ──────────────────────────────────────────────────────────────

  it('propagates LLM errors', async () => {
    llmRouter.completeStructured.mockRejectedValue(new Error('LLM unavailable'));
    await expect(agent.run(makeCtx())).rejects.toThrow('LLM unavailable');
  });

  // ── Cancellation ────────────────────────────────────────────────────────

  it('throws when context is cancelled before running', async () => {
    const ctx = makeCtx();
    ctx.cancel();
    await expect(agent.run(ctx)).rejects.toThrow('Pipeline cancelled');
    expect(llmRouter.completeStructured).not.toHaveBeenCalled();
  });
});
