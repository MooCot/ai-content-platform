import { ResearcherAgent } from './researcher.agent';
import { RAGService } from '../../rag/services/rag.service';
import { MemoryService } from '../../memory/memory.service';
import { DegradationService } from '../../resilience/degradation.service';
import { AgentContext } from '../context/agent-context';
import { AgentRole, ContentType, SearchResult } from '../../common/types/domain.types';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(opts: { ragEnabled?: boolean; queries?: string[] } = {}): AgentContext {
  const brand = createBrandFixture();
  const config = { ...brand.config, ragEnabled: opts.ragEnabled ?? true };
  const ctx = new AgentContext({
    jobId: 'job-res-1',
    brandId: brand.id,
    brandConfig: config,
    topic: 'Vector Databases',
    contentType: ContentType.BLOG,
    correlationId: 'corr-res-1',
  });
  ctx.searchQueries = opts.queries ?? ['vector db overview', 'semantic search'];
  return ctx;
}

function makeMeta(filename = 'intro.pdf', documentId = 'doc-1') {
  return { documentId, brandId: 'brand-test-uuid', filename, chunkIndex: 0 };
}

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunkId: 'chunk-1',
    content: 'Relevant content about vector databases.',
    score: 0.9,
    metadata: makeMeta(),
    ...overrides,
  };
}

function makeRagMock(): jest.Mocked<RAGService> {
  return { search: jest.fn().mockResolvedValue([]) } as unknown as jest.Mocked<RAGService>;
}

function makeMemoryMock(): jest.Mocked<MemoryService> {
  return {
    queryRelevant: jest.fn().mockResolvedValue([]),
  } as unknown as jest.Mocked<MemoryService>;
}

function makeDegradationMock(ragTimeout = 5_000): jest.Mocked<DegradationService> {
  return { ragTimeout } as unknown as jest.Mocked<DegradationService>;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('ResearcherAgent', () => {
  let rag: jest.Mocked<RAGService>;
  let memory: jest.Mocked<MemoryService>;

  beforeEach(() => {
    rag = makeRagMock();
    memory = makeMemoryMock();
  });

  // ── RAG disabled / no queries ───────────────────────────────────────────

  it('skips RAG and sets empty context when ragEnabled is false', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ ragEnabled: false });

    await agent.run(ctx);

    expect(rag.search).not.toHaveBeenCalled();
    expect(ctx.ragContext).toEqual([]);
    expect(ctx.citations).toEqual([]);
  });

  it('skips RAG and sets empty context when searchQueries is empty', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: [] });

    await agent.run(ctx);

    expect(rag.search).not.toHaveBeenCalled();
    expect(ctx.ragContext).toEqual([]);
    expect(ctx.citations).toEqual([]);
  });

  // ── Happy path ──────────────────────────────────────────────────────────

  it('calls RAGService.search for each query', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['query-a', 'query-b'] });
    rag.search.mockResolvedValue([makeResult()]);

    await agent.run(ctx);

    expect(rag.search).toHaveBeenCalledTimes(2);
    expect(rag.search).toHaveBeenCalledWith(ctx.brandId, 'query-a', 5, expect.any(Function));
    expect(rag.search).toHaveBeenCalledWith(ctx.brandId, 'query-b', 5, expect.any(Function));
  });

  it('populates ragContext with deduplicated high-score chunks sorted by score desc', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['q1', 'q2'] });

    const r1 = makeResult({ chunkId: 'c1', score: 0.95, metadata: makeMeta('a.pdf', 'd1') });
    const r2 = makeResult({ chunkId: 'c2', score: 0.8, metadata: makeMeta('b.pdf', 'd1') });
    const r3 = makeResult({ chunkId: 'c3', score: 0.75, metadata: makeMeta('a.pdf', 'd2') });

    // q1 returns r1 and r2; q2 returns r2 (duplicate) and r3
    rag.search.mockResolvedValueOnce([r1, r2]).mockResolvedValueOnce([r2, r3]);

    await agent.run(ctx);

    expect(ctx.ragContext).toHaveLength(3); // r2 deduplicated
    expect(ctx.ragContext[0].chunkId).toBe('c1'); // highest score first
    expect(ctx.ragContext[1].chunkId).toBe('c2');
    expect(ctx.ragContext[2].chunkId).toBe('c3');
  });

  it('filters out chunks with score <= 0.7', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['q1'] });

    rag.search.mockResolvedValueOnce([
      makeResult({ chunkId: 'high', score: 0.9 }),
      makeResult({ chunkId: 'boundary', score: 0.7 }), // exactly 0.7 → filtered (> not >=)
      makeResult({ chunkId: 'low', score: 0.5 }),
    ]);

    await agent.run(ctx);

    expect(ctx.ragContext.map((r) => r.chunkId)).toEqual(['high']);
  });

  it('caps ragContext at 15 chunks', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['q1'] });

    const chunks = Array.from({ length: 20 }, (_, i) =>
      makeResult({ chunkId: `c${i}`, score: 0.9 - i * 0.001 }),
    );
    rag.search.mockResolvedValueOnce(chunks);

    await agent.run(ctx);

    expect(ctx.ragContext).toHaveLength(15);
  });

  it('populates citations as deduplicated filenames from ragContext', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['q1'] });

    rag.search.mockResolvedValueOnce([
      makeResult({ chunkId: 'c1', score: 0.9, metadata: makeMeta('intro.pdf', 'd1') }),
      makeResult({ chunkId: 'c2', score: 0.85, metadata: makeMeta('advanced.pdf', 'd2') }),
      makeResult({ chunkId: 'c3', score: 0.8, metadata: makeMeta('intro.pdf', 'd3') }), // same file
    ]);

    await agent.run(ctx);

    expect(ctx.citations).toHaveLength(2);
    expect(ctx.citations).toContain('intro.pdf');
    expect(ctx.citations).toContain('advanced.pdf');
  });

  it('records an agent step after a successful run', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx();
    rag.search.mockResolvedValue([makeResult()]);

    await agent.run(ctx);

    expect(ctx.steps).toHaveLength(1);
    expect(ctx.steps[0].agent).toBe(AgentRole.RESEARCHER);
    expect(ctx.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(ctx.steps[0].output).not.toHaveProperty('timedOut');
  });

  // ── Individual query failures ───────────────────────────────────────────

  it('continues when a single query throws — treats that query as returning []', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['good', 'bad'] });

    rag.search
      .mockResolvedValueOnce([makeResult({ chunkId: 'c1', score: 0.9 })])
      .mockRejectedValueOnce(new Error('Qdrant timeout'));

    await agent.run(ctx);

    // The good query result should still be loaded
    expect(ctx.ragContext).toHaveLength(1);
    expect(ctx.ragContext[0].chunkId).toBe('c1');
    expect(ctx.degradation.isDegraded).toBe(false); // single query failure ≠ rag_timeout
  });

  // ── RAG timeout (full pipeline timeout) ────────────────────────────────

  it('appends rag_timeout and sets empty context when the RAG race times out', async () => {
    jest.useFakeTimers();
    try {
      const agent = new ResearcherAgent(rag, memory, makeDegradationMock(100));
      const ctx = makeCtx({ queries: ['slow query'] });

      // RAG hangs indefinitely
      rag.search.mockReturnValue(new Promise(() => {}) as Promise<SearchResult[]>);

      const runPromise = agent.run(ctx);
      await jest.runAllTimersAsync(); // drains timers AND flushes microtasks
      await runPromise;

      expect(ctx.degradation.isDegraded).toBe(true);
      expect(ctx.degradation.reasons).toContain('rag_timeout');
      expect(ctx.ragContext).toEqual([]);
      expect(ctx.citations).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('records a step with timedOut: true on RAG timeout', async () => {
    jest.useFakeTimers();
    try {
      const agent = new ResearcherAgent(rag, memory, makeDegradationMock(100));
      const ctx = makeCtx({ queries: ['slow'] });
      rag.search.mockReturnValue(new Promise(() => {}) as Promise<SearchResult[]>);

      const runPromise = agent.run(ctx);
      await jest.runAllTimersAsync();
      await runPromise;

      expect(ctx.steps).toHaveLength(1);
      expect(ctx.steps[0].output).toMatchObject({ timedOut: true, chunkCount: 0 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('uses 5000ms fallback timeout when DegradationService is not injected', async () => {
    jest.useFakeTimers();
    try {
      // No DegradationService — fallback to 5000ms
      const agent = new ResearcherAgent(rag, memory);
      const ctx = makeCtx({ queries: ['q'] });
      rag.search.mockReturnValue(new Promise(() => {}) as Promise<SearchResult[]>);

      const runPromise = agent.run(ctx);
      await jest.runAllTimersAsync();
      await runPromise;

      expect(ctx.degradation.reasons).toContain('rag_timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  // ── Memory recall (best-effort, 200ms timeout) ──────────────────────────

  it('does not throw if memory.queryRelevant times out', async () => {
    jest.useFakeTimers();
    try {
      memory.queryRelevant.mockReturnValue(
        new Promise(() => {}) as ReturnType<MemoryService['queryRelevant']>,
      );
      const agent = new ResearcherAgent(rag, memory);
      const ctx = makeCtx({ queries: [] }); // no RAG so pipeline resolves quickly after memory race

      const runPromise = agent.run(ctx);
      await jest.runAllTimersAsync();
      await runPromise;

      // Pipeline completes but records the timeout as a degradation reason
      expect(ctx.degradation.reasons).toContain('memory_timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('appends memory_timeout to ctx.degradation when memory recall exceeds 200ms', async () => {
    jest.useFakeTimers();
    try {
      memory.queryRelevant.mockReturnValue(
        new Promise(() => {}) as ReturnType<MemoryService['queryRelevant']>,
      );
      const agent = new ResearcherAgent(rag, memory);
      const ctx = makeCtx({ queries: [] });

      const runPromise = agent.run(ctx);
      await jest.runAllTimersAsync();
      await runPromise;

      expect(ctx.degradation.isDegraded).toBe(true);
      expect(ctx.degradation.reasons).toContain('memory_timeout');
    } finally {
      jest.useRealTimers();
    }
  });

  it('does NOT append memory_timeout when memory returns in time', async () => {
    memory.queryRelevant.mockResolvedValue([]);
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: [] });

    await agent.run(ctx);

    expect(ctx.degradation.reasons).not.toContain('memory_timeout');
  });

  // ── Contract violation callback ─────────────────────────────────────────

  it('appends contract_violation to ctx when RAGService calls onContractViolation', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['q1'] });

    // Simulate RAGService dropping one chunk and firing the callback
    rag.search.mockImplementation((_brandId, _query, _limit, onContractViolation) => {
      onContractViolation?.();
      return Promise.resolve([makeResult()]);
    });

    await agent.run(ctx);

    expect(ctx.degradation.reasons).toContain('contract_violation');
  });

  it('does NOT append contract_violation when all RAG results pass validation', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx({ queries: ['q1'] });
    rag.search.mockResolvedValue([makeResult()]);

    await agent.run(ctx);

    expect(ctx.degradation.reasons).not.toContain('contract_violation');
  });

  // ── Cancellation ────────────────────────────────────────────────────────

  it('throws when context is cancelled before running', async () => {
    const agent = new ResearcherAgent(rag, memory);
    const ctx = makeCtx();
    ctx.cancel();

    await expect(agent.run(ctx)).rejects.toThrow('Pipeline cancelled');
    expect(rag.search).not.toHaveBeenCalled();
  });
});
