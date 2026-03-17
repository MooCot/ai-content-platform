import { PlannerAgent } from './planner.agent';
import { LLMRouterService } from '../../llm/llm-router.service';
import { AgentRole, ContentType, LLMProvider, Tone } from '../../common/types/domain.types';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';
import { AgentContext } from '../context/agent-context';

function makeCtx(overrides = {}): AgentContext {
  const brand = createBrandFixture();
  return new AgentContext({
    jobId: 'job-1',
    brandId: brand.id,
    brandConfig: brand.config,
    topic: 'Vector Databases',
    contentType: ContentType.BLOG,
    correlationId: 'corr-1',
    ...overrides,
  });
}

describe('PlannerAgent', () => {
  let agent: PlannerAgent;
  let llmRouterMock: jest.Mocked<LLMRouterService>;

  beforeEach(() => {
    llmRouterMock = {
      completeStructured: jest.fn().mockResolvedValue({
        outline: ['Introduction', 'Core Concepts', 'Use Cases'],
        searchQueries: ['vector db overview', 'semantic search basics'],
        targetTone: Tone.TECHNICAL,
        wordCountTarget: 800,
        keyMessages: ['Speed', 'Accuracy', 'Scalability'],
      }),
    } as unknown as jest.Mocked<LLMRouterService>;

    agent = new PlannerAgent(llmRouterMock);
  });

  it('populates ctx.outline, ctx.searchQueries, ctx.targetTone after running', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.outline).toEqual(['Introduction', 'Core Concepts', 'Use Cases']);
    expect(ctx.searchQueries).toEqual(['vector db overview', 'semantic search basics']);
    expect(ctx.targetTone).toBe(Tone.TECHNICAL);
  });

  it('calls completeStructured with Claude as preferred provider (κ-invariant)', async () => {
    await agent.run(makeCtx());
    expect(llmRouterMock.completeStructured).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ preferredProvider: LLMProvider.CLAUDE }),
    );
  });

  it('records an agent step after completion', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.steps).toHaveLength(1);
    expect(ctx.steps[0].agent).toBe(AgentRole.PLANNER);
    expect(ctx.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when the context is cancelled before running', async () => {
    const ctx = makeCtx();
    ctx.cancel();
    await expect(agent.run(ctx)).rejects.toThrow('Pipeline cancelled');
  });

  it('propagates LLM errors without swallowing them', async () => {
    llmRouterMock.completeStructured.mockRejectedValue(new Error('LLM unavailable'));
    await expect(agent.run(makeCtx())).rejects.toThrow('LLM unavailable');
  });

  it('passes the brand systemPrompt to the LLM request', async () => {
    await agent.run(makeCtx());
    const [req] = llmRouterMock.completeStructured.mock.calls[0];
    expect(req.systemPrompt).toBe('You are a technical writer.');
  });
});
