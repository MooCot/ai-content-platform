import { AgentContext } from '../../src/agents/context/agent-context';
import { ContentType, Tone } from '../../src/common/types/domain.types';
import { createBrandFixture } from './brand.fixture';

export function createAgentContextFixture(
  overrides: Partial<ConstructorParameters<typeof AgentContext>[0]> = {},
): AgentContext {
  const brand = createBrandFixture();
  const ctx = new AgentContext({
    jobId: 'job-test-uuid',
    brandId: brand.id,
    brandConfig: brand.config,
    topic: 'Introduction to Vector Databases',
    contentType: ContentType.BLOG,
    correlationId: 'corr-test-uuid',
    ...overrides,
  });

  // Pre-populate pipeline stages so tests don't need to run each agent
  ctx.outline = ['What is a Vector DB', 'Use Cases', 'Getting Started'];
  ctx.searchQueries = ['vector database tutorial', 'embeddings explained'];
  ctx.targetTone = Tone.TECHNICAL;
  ctx.ragContext = [
    {
      chunkId: 'chunk-1',
      content: 'Vector databases store high-dimensional embeddings.',
      score: 0.92,
      metadata: { documentId: 'doc-1', brandId: brand.id, filename: 'intro.pdf', chunkIndex: 0 },
    },
  ];
  ctx.citations = ['intro.pdf'];
  ctx.draftContent = 'Vector databases are a new paradigm for semantic search.';
  ctx.optimizedContent = 'Vector databases enable semantic search at scale.';
  ctx.seoKeywords = ['vector database', 'embeddings', 'semantic search'];
  ctx.finalContent = 'Vector databases enable semantic search at scale. [optimized]';
  ctx.readabilityScore = 75;
  ctx.approved = true;

  ctx.recordStep({
    agent: 'PLANNER' as import('../../src/common/types/domain.types').AgentRole,
    input: { topic: ctx.topic },
    output: { outline: ctx.outline },
    modelUsed: 'claude-sonnet-4-6',
    durationMs: 1200,
    tokens: { promptTokens: 200, completionTokens: 100, totalTokens: 300 },
  });

  return ctx;
}
