import { Injectable, Logger } from '@nestjs/common';
import { RAGService } from '../../rag/services/rag.service';
import { MemoryService } from '../../memory/memory.service';
import { AgentContext } from '../context/agent-context';
import { AgentRole, SearchResult } from '../../common/types/domain.types';

@Injectable()
export class ResearcherAgent {
  private readonly logger = new Logger(ResearcherAgent.name);

  constructor(
    private readonly ragService: RAGService,
    private readonly memory: MemoryService,
  ) {}

  async run(ctx: AgentContext): Promise<void> {
    ctx.checkCancelled(AgentRole.RESEARCHER);
    const startedAt = Date.now();

    this.logger.log(`[${ctx.jobId}] ResearcherAgent: ${ctx.searchQueries.length} queries`);

    // Recall relevant past generations for this topic (best-effort, 200 ms timeout)
    const pastMemories = await Promise.race([
      this.memory.queryRelevant(ctx.brandId, ctx.topic, { limit: 3 }),
      new Promise<[]>((resolve) => setTimeout(() => resolve([]), 200)),
    ]);

    if (pastMemories.length) {
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

    // Run all queries in parallel
    const allResults = await Promise.all(
      ctx.searchQueries.map((q) =>
        this.ragService.search(ctx.brandId, q, 5).catch(() => [] as SearchResult[]),
      ),
    );

    // Deduplicate by chunkId
    const seen = new Set<string>();
    const deduped: SearchResult[] = [];
    for (const results of allResults) {
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
