import { Observable, of, throwError } from 'rxjs';
import { GeneratorAgent } from './generator.agent';
import { LLMRouterService } from '../../llm/llm-router.service';
import { StreamingService } from '../../streaming/streaming.service';
import { AgentContext } from '../context/agent-context';
import { AgentRole, ContentType, LLMProvider, Tone } from '../../common/types/domain.types';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';
import { LLMStreamChunk } from '../../common/interfaces/llm-provider.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(): AgentContext {
  const brand = createBrandFixture();
  const ctx = new AgentContext({
    jobId: 'job-gen-1',
    brandId: brand.id,
    brandConfig: brand.config,
    topic: 'Vector Databases',
    contentType: ContentType.BLOG,
    correlationId: 'corr-gen-1',
  });
  ctx.outline = ['Intro', 'Core Concepts', 'Use Cases'];
  ctx.targetTone = Tone.TECHNICAL;
  ctx.ragContext = [
    {
      chunkId: 'c1',
      content: 'Vector stores enable semantic search.',
      score: 0.9,
      metadata: { documentId: 'd1', brandId: brand.id, filename: 'intro.pdf', chunkIndex: 0 },
    },
  ];
  return ctx;
}

function makeDefaultChunks(): LLMStreamChunk[] {
  return [
    { delta: 'Vector databases ', done: false },
    { delta: 'power semantic search.', done: false },
    { delta: '', done: true, usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 } },
  ];
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('GeneratorAgent', () => {
  let llmRouter: jest.Mocked<LLMRouterService>;
  let streaming: jest.Mocked<StreamingService>;
  let agent: GeneratorAgent;

  beforeEach(() => {
    llmRouter = {
      stream: jest.fn().mockReturnValue(of(...makeDefaultChunks())),
    } as unknown as jest.Mocked<LLMRouterService>;

    streaming = {
      emit: jest.fn(),
    } as unknown as jest.Mocked<StreamingService>;

    agent = new GeneratorAgent(llmRouter, streaming);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('populates ctx.draftContent with concatenated stream deltas', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);
    expect(ctx.draftContent).toBe('Vector databases power semantic search.');
  });

  it('emits a token SSE event for each delta chunk', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    const tokenEmits = (streaming.emit as jest.Mock).mock.calls.filter(
      ([, e]) => e.type === 'token',
    );
    expect(tokenEmits).toHaveLength(2); // two non-empty deltas
    expect(tokenEmits[0][1].data.delta).toBe('Vector databases ');
    expect(tokenEmits[1][1].data.delta).toBe('power semantic search.');
  });

  it('records an agent step with GENERATOR role', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.steps).toHaveLength(1);
    expect(ctx.steps[0].agent).toBe(AgentRole.GENERATOR);
    expect(ctx.steps[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('calls stream() with Claude as preferred provider', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(llmRouter.stream).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ preferredProvider: LLMProvider.CLAUDE }),
    );
  });

  it('includes RAG context in the prompt when ragContext is present', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    const [req] = llmRouter.stream.mock.calls[0];
    expect(req.messages[0].content).toContain('Knowledge Base Context');
    expect(req.messages[0].content).toContain('Vector stores enable semantic search.');
  });

  it('includes outline in the prompt when outline is present', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    const [req] = llmRouter.stream.mock.calls[0];
    expect(req.messages[0].content).toContain('Content Outline');
    expect(req.messages[0].content).toContain('Intro');
  });

  it('omits Knowledge Base Context section when ragContext is empty', async () => {
    const ctx = makeCtx();
    ctx.ragContext = [];
    await agent.run(ctx);

    const [req] = llmRouter.stream.mock.calls[0];
    expect(req.messages[0].content).not.toContain('Knowledge Base Context');
  });

  it('captures token usage from the done chunk', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.steps[0].tokens).toEqual({
      promptTokens: 50,
      completionTokens: 30,
      totalTokens: 80,
    });
  });

  // ── LLM fallback ────────────────────────────────────────────────────────

  it('appends llm_fallback to degradation when onFallback is triggered', async () => {
    llmRouter.stream.mockImplementation((_req, options) => {
      // simulate provider fallback before streaming begins
      options?.onFallback?.(LLMProvider.OPENAI);
      return of(...makeDefaultChunks());
    });

    const ctx = makeCtx();
    await agent.run(ctx);

    expect(ctx.degradation.isDegraded).toBe(true);
    expect(ctx.degradation.reasons).toContain('llm_fallback');
  });

  it('passes onFallback in options to stream()', async () => {
    const ctx = makeCtx();
    await agent.run(ctx);

    const [, options] = llmRouter.stream.mock.calls[0];
    expect(options).toHaveProperty('onFallback');
    expect(typeof options?.onFallback).toBe('function');
  });

  // ── Stream errors ────────────────────────────────────────────────────────

  it('propagates stream errors without swallowing them', async () => {
    llmRouter.stream.mockReturnValue(throwError(() => new Error('stream broken')));
    const ctx = makeCtx();
    await expect(agent.run(ctx)).rejects.toThrow('stream broken');
  });

  it('stops accumulating content for chunks arriving after mid-stream cancellation', async () => {
    const ctx = makeCtx();

    // Stream cancels the context after the first chunk, then emits one more
    llmRouter.stream.mockImplementation(
      () =>
        new Observable<LLMStreamChunk>((sub) => {
          void Promise.resolve().then(() => {
            sub.next({ delta: 'before cancel', done: false });
            ctx.cancel(); // cancel after the first chunk
            sub.next({ delta: 'after cancel', done: false });
            sub.next({ delta: '', done: true });
            sub.complete();
          });
        }),
    );

    await agent.run(ctx);

    // Only the pre-cancel chunk should be in draftContent
    expect(ctx.draftContent).toBe('before cancel');
    const tokenEmits = (streaming.emit as jest.Mock).mock.calls.filter(
      ([, e]) => e.type === 'token',
    );
    expect(tokenEmits).toHaveLength(1);
  });

  // ── Cancellation ────────────────────────────────────────────────────────

  it('throws when context is cancelled before running', async () => {
    const ctx = makeCtx();
    ctx.cancel();

    // Need a fresh mock so stream() isn't called before the cancel check
    const freshAgent = new GeneratorAgent(llmRouter, streaming);
    await expect(freshAgent.run(ctx)).rejects.toThrow('Pipeline cancelled');
    expect(llmRouter.stream).not.toHaveBeenCalled();
  });
});
