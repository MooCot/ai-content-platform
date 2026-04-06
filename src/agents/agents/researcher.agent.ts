import { Injectable, Logger, Optional } from '@nestjs/common';
import { RAGService } from '../../rag/services/rag.service';
import { MemoryService } from '../../memory/memory.service';
import { AgentContext } from '../context/agent-context';
import { AgentRole, SearchResult } from '../../common/types/domain.types';
import { DegradationService } from '../../resilience/degradation.service';

@Injectable()
export class ResearcherAgent {
  private readonly logger = new Logger(ResearcherAgent.name);

  constructor(
    private readonly ragService: RAGService,
    private readonly memory: MemoryService,
    @Optional() private readonly degradationService?: DegradationService,
  ) {}

  async run(ctx: AgentContext): Promise<void> {
    ctx.checkCancelled(AgentRole.RESEARCHER);
    const startedAt = Date.now();

    this.logger.log(`[${ctx.jobId}] ResearcherAgent: ${ctx.searchQueries.length} queries`);

    // Recall relevant past generations for this topic (best-effort, 200 ms timeout).
    // If the vector store is slow we continue without memory rather than blocking
    // the pipeline — but we do record it as a degradation reason so clients know
    // the context may be less personalised than usual.
    let memoryTimedOut = false;
    const memoryTimeoutHandle = new Promise<[]>((resolve) =>
      setTimeout(() => {
        memoryTimedOut = true;
        resolve([]);
      }, 200),
    );
    const pastMemories = await Promise.race([
      this.memory.queryRelevant(ctx.brandId, ctx.topic, { limit: 3 }),
      memoryTimeoutHandle,
    ]);

    if (memoryTimedOut) {
      ctx.degradation.append('memory_timeout');
      this.logger.debug(`[${ctx.jobId}] Memory recall timed out after 200ms`);
    } else if (pastMemories.length) {
      this.logger.debug(
        `[${ctx.jobId}] Loaded ${pastMemories.length} past memory entries for topic "${ctx.topic}"`,
      );
      // Store on context so generator/optimizer can reference prior angles
      (ctx as unknown as Record<string, unknown>)['pastMemories'] = pastMemories;
    }

    if (!ctx.brandConfig.ragEnabled || ctx.searchQueries.length === 0) {
      this.logger.log(`[${ctx.jobId}] RAG disabled or no queries — skipping`);
      ctx.ragContext = [];
      ctx.citations = [];
      return;
    }

    // ── RAG search with configurable timeout ────────────────────────────────
    // If the vector store is slow or unavailable, we continue without context
    // rather than blocking or failing the pipeline.
    const ragTimeout = this.degradationService?.ragTimeout ?? 5_000;

    const ragResults = await Promise.race([
      Promise.all(
        ctx.searchQueries.map((q) =>
          this.ragService
            .search(ctx.brandId, q, 5, () => ctx.degradation.append('contract_violation'))
            .catch(() => [] as SearchResult[]),
        ),
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ragTimeout)),
    ]);

    if (ragResults === null) {
      this.logger.warn(
        `[${ctx.jobId}] RAG search timed out after ${ragTimeout}ms — continuing without context`,
      );
      ctx.degradation.append('rag_timeout');
      ctx.ragContext = [];
      ctx.citations = [];

      ctx.recordStep({
        agent: AgentRole.RESEARCHER,
        input: { queries: ctx.searchQueries },
        output: { chunkCount: 0, citations: [], timedOut: true },
        modelUsed: 'rag',
        durationMs: ragTimeout,
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
      return;
    }

    // Deduplicate by chunkId
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const results of ragResults) {
      for (const r of results) {
        if (!seen.has(r.chunkId) && r.score > 0.7) {
          seen.add(r.chunkId);
          deduped.push(r);
        }
      }
    }

    // Sort by score descending, keep top 15
    deduped.sort((a, b) => b.score - a.score);
    ctx.ragContext = deduped.slice(0, 15);
    ctx.citations = [...new Set(deduped.map((r) => r.metadata.filename))];

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[${ctx.jobId}] ResearcherAgent done: ${ctx.ragContext.length} chunks, ${ctx.citations.length} sources`,
    );

    ctx.recordStep({
      agent: AgentRole.RESEARCHER,
      input: { queries: ctx.searchQueries },
      output: {
        chunkCount: ctx.ragContext.length,
        citations: ctx.citations,
        topScores: ctx.ragContext.slice(0, 3).map((r) => r.score),
      },
      modelUsed: 'rag',
      durationMs,
      tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    });
  }
}
