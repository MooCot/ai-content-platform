/**
 * Direct schema validation tests for all v1 contract schemas.
 *
 * These tests verify the specific field constraints and invariants
 * documented in each contract — things that are not exercised by
 * ContractRegistryService unit tests (which use generic test schemas).
 */

import {
  ContentType,
  JobStatus,
  AgentRole,
  Tone,
  LLMProvider,
} from '../../common/types/domain.types';

// ── Queue contracts ────────────────────────────────────────────────────────────
import { ContentGenerationJobContractV1 } from './queue/content-generation-job.contract';
import { ContentResultContractV1, JobStateContractV1 } from './queue/job-state.contract';

// ── SSE contracts ─────────────────────────────────────────────────────────────
import { SSEEventContractV1 } from './events/sse-events.contract';

// ── RAG contracts ─────────────────────────────────────────────────────────────
import {
  DocumentChunkContractV1,
  RetrievalResultContractV1,
  EmbeddingVersionContractV1,
} from './rag/retrieval-result.contract';

// ── Evaluation contracts ──────────────────────────────────────────────────────
import { EvaluationResultContractV1 } from './evaluation/evaluation-result.contract';

// ── Agent contracts ───────────────────────────────────────────────────────────
import { PlannerInputContractV1, PlannerOutputContractV1 } from './agents/planner.contract';
import {
  ResearcherInputContractV1,
  ResearcherOutputContractV1,
} from './agents/researcher.contract';
import { GeneratorInputContractV1, GeneratorOutputContractV1 } from './agents/generator.contract';
import { OptimizerInputContractV1, OptimizerOutputContractV1 } from './agents/optimizer.contract';
import { QAInputContractV1, QAOutputContractV1 } from './agents/qa.contract';

// ── Helpers ───────────────────────────────────────────────────────────────────

function valid<T>(
  schema: { safeParse: (d: unknown) => { success: boolean; data?: T } },
  data: unknown,
): T {
  const result = schema.safeParse(data);
  if (!result.success)
    throw new Error(
      `Expected valid, got: ${JSON.stringify((result as { success: false; error: { issues: unknown[] } }).error.issues)}`,
    );
  return result.data as T;
}

function invalid(schema: { safeParse: (d: unknown) => { success: boolean } }, data: unknown): void {
  const result = schema.safeParse(data);
  if (result.success)
    throw new Error(`Expected invalid, but schema accepted: ${JSON.stringify(data)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ContentGenerationJobContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('ContentGenerationJobContractV1', () => {
  const base = {
    jobId: 'job-1',
    brandId: 'brand-1',
    dto: { topic: 'AI trends', contentType: ContentType.BLOG },
    correlationId: 'corr-1',
    idempotencyKey: 'idem-1',
    enqueuedAt: '2024-01-01T00:00:00.000Z',
  };

  it('accepts a fully valid payload', () => {
    expect(() => valid(ContentGenerationJobContractV1, base)).not.toThrow();
  });

  it('defaults _contractVersion to "v1" when omitted', () => {
    const parsed = valid(ContentGenerationJobContractV1, base);
    expect(parsed._contractVersion).toBe('v1');
  });

  it('rejects when _contractVersion is not "v1"', () => {
    invalid(ContentGenerationJobContractV1, { ...base, _contractVersion: 'v2' });
  });

  it('rejects empty jobId', () => {
    invalid(ContentGenerationJobContractV1, { ...base, jobId: '' });
  });

  it('rejects empty brandId', () => {
    invalid(ContentGenerationJobContractV1, { ...base, brandId: '' });
  });

  it('rejects topic longer than 300 characters', () => {
    invalid(ContentGenerationJobContractV1, {
      ...base,
      dto: { topic: 'x'.repeat(301), contentType: ContentType.BLOG },
    });
  });

  it('rejects empty topic', () => {
    invalid(ContentGenerationJobContractV1, {
      ...base,
      dto: { topic: '', contentType: ContentType.BLOG },
    });
  });

  it('rejects an unknown contentType', () => {
    invalid(ContentGenerationJobContractV1, {
      ...base,
      dto: { topic: 'test', contentType: 'INVALID_TYPE' },
    });
  });

  it('rejects enqueuedAt that is not ISO-8601 datetime', () => {
    invalid(ContentGenerationJobContractV1, { ...base, enqueuedAt: '2024-01-01' });
  });

  it('rejects missing correlationId', () => {
    const withoutCorr = (({ correlationId: _c, ...rest }) => rest)(base);
    invalid(ContentGenerationJobContractV1, withoutCorr);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ContentResultContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('ContentResultContractV1', () => {
  const base = {
    raw: 'draft text',
    optimized: 'optimized text',
    seoKeywords: ['kw1'],
    readabilityScore: 72,
    toneAnalysis: { detected: Tone.TECHNICAL, confidence: 0.9, scores: {} },
    wordCount: 150,
    citations: [],
  };

  it('accepts a clean result and applies degradation defaults', () => {
    const parsed = valid(ContentResultContractV1, base);
    expect(parsed.degraded).toBe(false);
    expect(parsed.degradationReasons).toEqual([]);
  });

  it('preserves explicit degradation fields', () => {
    const parsed = valid(ContentResultContractV1, {
      ...base,
      degraded: true,
      degradationReasons: ['rag_timeout', 'optional_agent_skipped'],
    });
    expect(parsed.degraded).toBe(true);
    expect(parsed.degradationReasons).toEqual(['rag_timeout', 'optional_agent_skipped']);
  });

  it('rejects readabilityScore > 100', () => {
    invalid(ContentResultContractV1, { ...base, readabilityScore: 101 });
  });

  it('rejects readabilityScore < 0', () => {
    invalid(ContentResultContractV1, { ...base, readabilityScore: -1 });
  });

  it('rejects confidence outside [0, 1]', () => {
    invalid(ContentResultContractV1, {
      ...base,
      toneAnalysis: { detected: Tone.FORMAL, confidence: 1.1, scores: {} },
    });
  });

  it('rejects non-integer wordCount', () => {
    invalid(ContentResultContractV1, { ...base, wordCount: 1.5 });
  });

  it('rejects wordCount < 0', () => {
    invalid(ContentResultContractV1, { ...base, wordCount: -1 });
  });

  it('rejects unknown Tone in toneAnalysis.detected', () => {
    invalid(ContentResultContractV1, {
      ...base,
      toneAnalysis: { detected: 'UNKNOWN_TONE', confidence: 0.5, scores: {} },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// JobStateContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('JobStateContractV1', () => {
  const base = {
    jobId: 'job-1',
    brandId: 'brand-1',
    contentType: ContentType.BLOG,
    status: JobStatus.DONE,
  };

  it('accepts a minimal valid payload', () => {
    expect(() => valid(JobStateContractV1, base)).not.toThrow();
  });

  it('defaults _contractVersion to "v1"', () => {
    const parsed = valid(JobStateContractV1, base);
    expect(parsed._contractVersion).toBe('v1');
  });

  it('rejects unknown status value', () => {
    invalid(JobStateContractV1, { ...base, status: 'SLEEPING' });
  });

  it('accepts result: null explicitly', () => {
    expect(() => valid(JobStateContractV1, { ...base, result: null })).not.toThrow();
  });

  it('accepts optional errorMessage', () => {
    const parsed = valid(JobStateContractV1, { ...base, errorMessage: 'pipeline failed' });
    expect(parsed.errorMessage).toBe('pipeline failed');
  });

  it('accepts optional updatedAt when ISO datetime', () => {
    expect(() =>
      valid(JobStateContractV1, { ...base, updatedAt: '2024-06-01T12:00:00.000Z' }),
    ).not.toThrow();
  });

  it('rejects updatedAt that is not ISO datetime', () => {
    invalid(JobStateContractV1, { ...base, updatedAt: 'not-a-date' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SSEEventContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('SSEEventContractV1', () => {
  it('accepts a valid "token" event', () => {
    expect(() =>
      valid(SSEEventContractV1, { type: 'token', data: { delta: 'chunk' }, jobId: 'j1' }),
    ).not.toThrow();
  });

  it('accepts a valid "agent_start" event', () => {
    expect(() =>
      valid(SSEEventContractV1, {
        type: 'agent_start',
        data: { agent: AgentRole.GENERATOR },
        jobId: 'j1',
      }),
    ).not.toThrow();
  });

  it('accepts a valid "agent_done" event with optional durationMs', () => {
    expect(() =>
      valid(SSEEventContractV1, {
        type: 'agent_done',
        data: { agent: AgentRole.QA, durationMs: 1234 },
        jobId: 'j1',
      }),
    ).not.toThrow();
  });

  it('accepts "agent_done" without durationMs', () => {
    expect(() =>
      valid(SSEEventContractV1, {
        type: 'agent_done',
        data: { agent: AgentRole.PLANNER },
        jobId: 'j1',
      }),
    ).not.toThrow();
  });

  it('accepts a valid "job_done" event', () => {
    const contentResult = {
      raw: 'r',
      optimized: 'o',
      seoKeywords: [],
      readabilityScore: 70,
      toneAnalysis: { detected: Tone.FORMAL, confidence: 0.8, scores: {} },
      wordCount: 50,
      citations: [],
    };
    expect(() =>
      valid(SSEEventContractV1, {
        type: 'job_done',
        data: { jobId: 'j1', status: JobStatus.DONE, result: contentResult },
        jobId: 'j1',
      }),
    ).not.toThrow();
  });

  it('accepts "error" event with "message" field', () => {
    expect(() =>
      valid(SSEEventContractV1, {
        type: 'error',
        data: { message: 'something broke' },
        jobId: 'j1',
      }),
    ).not.toThrow();
  });

  it('accepts "error" event with "error" field', () => {
    expect(() =>
      valid(SSEEventContractV1, {
        type: 'error',
        data: { error: 'pipeline failed', jobId: 'j1' },
        jobId: 'j1',
      }),
    ).not.toThrow();
  });

  it('rejects "error" event data missing both "message" and "error"', () => {
    invalid(SSEEventContractV1, {
      type: 'error',
      data: { reason: 'unexpected' }, // neither "message" nor "error"
      jobId: 'j1',
    });
  });

  it('accepts a valid "heartbeat" event', () => {
    expect(() =>
      valid(SSEEventContractV1, { type: 'heartbeat', data: {}, jobId: 'j1' }),
    ).not.toThrow();
  });

  it('rejects an unknown event type', () => {
    invalid(SSEEventContractV1, { type: 'unknown_type', data: {}, jobId: 'j1' });
  });

  it('rejects a missing jobId', () => {
    invalid(SSEEventContractV1, { type: 'token', data: { delta: 'x' } });
  });

  it('rejects empty jobId', () => {
    invalid(SSEEventContractV1, { type: 'token', data: { delta: 'x' }, jobId: '' });
  });

  it('rejects unknown AgentRole in agent_start', () => {
    invalid(SSEEventContractV1, {
      type: 'agent_start',
      data: { agent: 'INVALID_ROLE' },
      jobId: 'j1',
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DocumentChunkContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('DocumentChunkContractV1', () => {
  const base = {
    documentId: 'doc-1',
    brandId: 'brand-1',
    filename: 'report.pdf',
    chunkIndex: 0,
  };

  it('accepts a valid chunk metadata', () => {
    expect(() => valid(DocumentChunkContractV1, base)).not.toThrow();
  });

  it('accepts optional page and section fields', () => {
    const parsed = valid(DocumentChunkContractV1, { ...base, page: 3, section: 'Introduction' });
    expect(parsed.page).toBe(3);
    expect(parsed.section).toBe('Introduction');
  });

  it('rejects empty brandId (brand isolation invariant)', () => {
    invalid(DocumentChunkContractV1, { ...base, brandId: '' });
  });

  it('rejects empty documentId', () => {
    invalid(DocumentChunkContractV1, { ...base, documentId: '' });
  });

  it('rejects negative chunkIndex', () => {
    invalid(DocumentChunkContractV1, { ...base, chunkIndex: -1 });
  });

  it('rejects non-integer chunkIndex', () => {
    invalid(DocumentChunkContractV1, { ...base, chunkIndex: 1.5 });
  });

  it('rejects empty filename', () => {
    invalid(DocumentChunkContractV1, { ...base, filename: '' });
  });

  it('rejects negative page', () => {
    invalid(DocumentChunkContractV1, { ...base, page: -1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RetrievalResultContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('RetrievalResultContractV1', () => {
  const base = {
    chunkId: 'chunk-uuid-1',
    content: 'Relevant text about AI.',
    score: 0.85,
    metadata: {
      documentId: 'doc-1',
      brandId: 'brand-1',
      filename: 'report.pdf',
      chunkIndex: 2,
    },
  };

  it('accepts a valid retrieval result', () => {
    expect(() => valid(RetrievalResultContractV1, base)).not.toThrow();
  });

  it('accepts score at boundary values 0 and 1', () => {
    expect(() => valid(RetrievalResultContractV1, { ...base, score: 0 })).not.toThrow();
    expect(() => valid(RetrievalResultContractV1, { ...base, score: 1 })).not.toThrow();
  });

  it('rejects score > 1', () => {
    invalid(RetrievalResultContractV1, { ...base, score: 1.01 });
  });

  it('rejects score < 0', () => {
    invalid(RetrievalResultContractV1, { ...base, score: -0.01 });
  });

  it('rejects empty content', () => {
    invalid(RetrievalResultContractV1, { ...base, content: '' });
  });

  it('rejects empty chunkId', () => {
    invalid(RetrievalResultContractV1, { ...base, chunkId: '' });
  });

  it('rejects missing metadata', () => {
    const withoutMeta = (({ metadata: _m, ...rest }) => rest)(base);
    invalid(RetrievalResultContractV1, withoutMeta);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EmbeddingVersionContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('EmbeddingVersionContractV1', () => {
  const base = {
    model: 'text-embedding-3-small',
    dimension: 1536,
    collectionName: 'brand_acme-corp',
  };

  it('accepts a valid embedding version', () => {
    expect(() => valid(EmbeddingVersionContractV1, base)).not.toThrow();
  });

  it('accepts various valid brand_ collection names', () => {
    const names = ['brand_abc', 'brand_my-brand', 'brand_brand_123', 'brand_A1-B2_C3'];
    names.forEach((collectionName) => {
      expect(() => valid(EmbeddingVersionContractV1, { ...base, collectionName })).not.toThrow();
    });
  });

  it('rejects collection name not starting with brand_', () => {
    invalid(EmbeddingVersionContractV1, { ...base, collectionName: 'my_collection' });
  });

  it('rejects collection name "brand_" with empty suffix', () => {
    invalid(EmbeddingVersionContractV1, { ...base, collectionName: 'brand_' });
  });

  it('rejects collection name with spaces', () => {
    invalid(EmbeddingVersionContractV1, { ...base, collectionName: 'brand_my brand' });
  });

  it('rejects non-positive dimension', () => {
    invalid(EmbeddingVersionContractV1, { ...base, dimension: 0 });
  });

  it('rejects non-integer dimension', () => {
    invalid(EmbeddingVersionContractV1, { ...base, dimension: 1536.5 });
  });

  it('rejects empty model name', () => {
    invalid(EmbeddingVersionContractV1, { ...base, model: '' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// EvaluationResultContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('EvaluationResultContractV1', () => {
  const base = {
    jobId: 'job-1',
    brandId: 'brand-1',
    contentType: ContentType.BLOG,
    modelId: 'claude-sonnet-4-6',
    promptVersion: '1.0.0',
    relevanceScore: 0.9,
    toneScore: 0.8,
    factualityScore: 0.85,
    readabilityScore: 0.75,
    compositeScore: 0.82,
    dimensions: {
      relevance: { score: 0.9 },
      tone: { score: 0.8, detected: 'TECHNICAL', target: 'FORMAL' },
      factuality: { score: 0.85, supportedClaims: 8, totalClaims: 10 },
      readability: { score: 0.75 },
    },
  };

  it('accepts a fully valid evaluation result', () => {
    expect(() => valid(EvaluationResultContractV1, base)).not.toThrow();
  });

  it('defaults _contractVersion to "v1"', () => {
    const parsed = valid(EvaluationResultContractV1, base);
    expect(parsed._contractVersion).toBe('v1');
  });

  it('rejects promptVersion not matching semver x.y.z', () => {
    invalid(EvaluationResultContractV1, { ...base, promptVersion: '1.0' });
    invalid(EvaluationResultContractV1, { ...base, promptVersion: 'v1.0.0' });
    invalid(EvaluationResultContractV1, { ...base, promptVersion: '1.0.0.0' });
  });

  it('accepts valid semver promptVersion strings', () => {
    expect(() =>
      valid(EvaluationResultContractV1, { ...base, promptVersion: '2.14.3' }),
    ).not.toThrow();
    expect(() =>
      valid(EvaluationResultContractV1, { ...base, promptVersion: '0.0.1' }),
    ).not.toThrow();
  });

  it('rejects compositeScore > 1', () => {
    invalid(EvaluationResultContractV1, { ...base, compositeScore: 1.01 });
  });

  it('rejects compositeScore < 0', () => {
    invalid(EvaluationResultContractV1, { ...base, compositeScore: -0.01 });
  });

  it('rejects relevanceScore out of [0, 1]', () => {
    invalid(EvaluationResultContractV1, { ...base, relevanceScore: 1.5 });
  });

  it('rejects negative supportedClaims', () => {
    invalid(EvaluationResultContractV1, {
      ...base,
      dimensions: {
        ...base.dimensions,
        factuality: { score: 0.85, supportedClaims: -1, totalClaims: 10 },
      },
    });
  });

  it('rejects non-integer totalClaims', () => {
    invalid(EvaluationResultContractV1, {
      ...base,
      dimensions: {
        ...base.dimensions,
        factuality: { score: 0.85, supportedClaims: 8, totalClaims: 10.5 },
      },
    });
  });

  it('rejects unknown contentType', () => {
    invalid(EvaluationResultContractV1, { ...base, contentType: 'UNKNOWN' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent contracts — PlannerInputContractV1 / PlannerOutputContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlannerInputContractV1', () => {
  const base = {
    jobId: 'j1',
    brandId: 'b1',
    topic: 'AI in healthcare',
    contentType: ContentType.BLOG,
    brandConfig: {
      defaultTone: Tone.FORMAL,
      allowedModels: ['claude-sonnet-4-6'],
      preferredProvider: LLMProvider.CLAUDE,
      ragEnabled: true,
      systemPrompt: 'You are a helpful writer.',
      maxContentLength: 1000,
    },
    correlationId: 'corr-1',
  };

  it('accepts a valid input', () => {
    expect(() => valid(PlannerInputContractV1, base)).not.toThrow();
  });

  it('rejects topic longer than 300 chars', () => {
    invalid(PlannerInputContractV1, { ...base, topic: 'x'.repeat(301) });
  });

  it('rejects maxContentLength < 100', () => {
    invalid(PlannerInputContractV1, {
      ...base,
      brandConfig: { ...base.brandConfig, maxContentLength: 99 },
    });
  });

  it('rejects unknown preferredProvider', () => {
    invalid(PlannerInputContractV1, {
      ...base,
      brandConfig: { ...base.brandConfig, preferredProvider: 'UNKNOWN_PROVIDER' },
    });
  });
});

describe('PlannerOutputContractV1', () => {
  const base = {
    outline: ['Intro', 'Section 1', 'Section 2', 'Conclusion'],
    searchQueries: ['AI healthcare', 'ML diagnostics'],
    targetTone: Tone.FORMAL,
    wordCountTarget: 800,
    keyMessages: ['AI improves diagnostics'],
  };

  it('accepts a valid output', () => {
    expect(() => valid(PlannerOutputContractV1, base)).not.toThrow();
  });

  it('rejects outline with fewer than 3 items', () => {
    invalid(PlannerOutputContractV1, { ...base, outline: ['Intro', 'Section 1'] });
  });

  it('rejects outline with more than 10 items', () => {
    invalid(PlannerOutputContractV1, {
      ...base,
      outline: Array.from({ length: 11 }, (_, i) => `Section ${i}`),
    });
  });

  it('rejects fewer than 2 searchQueries', () => {
    invalid(PlannerOutputContractV1, { ...base, searchQueries: ['only one'] });
  });

  it('rejects more than 8 searchQueries', () => {
    invalid(PlannerOutputContractV1, {
      ...base,
      searchQueries: Array.from({ length: 9 }, (_, i) => `query ${i}`),
    });
  });

  it('rejects wordCountTarget < 200', () => {
    invalid(PlannerOutputContractV1, { ...base, wordCountTarget: 199 });
  });

  it('rejects wordCountTarget > 5000', () => {
    invalid(PlannerOutputContractV1, { ...base, wordCountTarget: 5001 });
  });

  it('rejects empty keyMessages array', () => {
    invalid(PlannerOutputContractV1, { ...base, keyMessages: [] });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent contracts — ResearcherInputContractV1 / ResearcherOutputContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('ResearcherInputContractV1', () => {
  const base = {
    jobId: 'j1',
    brandId: 'b1',
    searchQueries: ['query 1', 'query 2'],
    ragEnabled: true,
  };

  it('accepts valid input', () => {
    expect(() => valid(ResearcherInputContractV1, base)).not.toThrow();
  });

  it('rejects empty searchQueries array', () => {
    invalid(ResearcherInputContractV1, { ...base, searchQueries: [] });
  });

  it('rejects a query that is an empty string', () => {
    invalid(ResearcherInputContractV1, { ...base, searchQueries: [''] });
  });
});

describe('ResearcherOutputContractV1', () => {
  const base = { chunkCount: 5, citations: ['file.pdf'], topScores: [0.9, 0.85] };

  it('accepts valid output', () => {
    expect(() => valid(ResearcherOutputContractV1, base)).not.toThrow();
  });

  it('rejects negative chunkCount', () => {
    invalid(ResearcherOutputContractV1, { ...base, chunkCount: -1 });
  });

  it('rejects topScore > 1', () => {
    invalid(ResearcherOutputContractV1, { ...base, topScores: [1.1] });
  });

  it('accepts empty citations and topScores', () => {
    expect(() =>
      valid(ResearcherOutputContractV1, { chunkCount: 0, citations: [], topScores: [] }),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent contracts — GeneratorInputContractV1 / GeneratorOutputContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('GeneratorInputContractV1', () => {
  const base = {
    jobId: 'j1',
    brandId: 'b1',
    outline: ['Intro', 'Body'],
    targetTone: Tone.CASUAL,
    ragContextCount: 3,
  };

  it('accepts valid input without optional wordCountTarget', () => {
    expect(() => valid(GeneratorInputContractV1, base)).not.toThrow();
  });

  it('accepts optional wordCountTarget >= 100', () => {
    expect(() => valid(GeneratorInputContractV1, { ...base, wordCountTarget: 500 })).not.toThrow();
  });

  it('rejects wordCountTarget < 100', () => {
    invalid(GeneratorInputContractV1, { ...base, wordCountTarget: 99 });
  });

  it('rejects empty outline', () => {
    invalid(GeneratorInputContractV1, { ...base, outline: [] });
  });

  it('rejects negative ragContextCount', () => {
    invalid(GeneratorInputContractV1, { ...base, ragContextCount: -1 });
  });
});

describe('GeneratorOutputContractV1', () => {
  it('accepts valid output', () => {
    expect(() =>
      valid(GeneratorOutputContractV1, { wordCount: 300, streamedTokens: 450 }),
    ).not.toThrow();
  });

  it('rejects wordCount < 1', () => {
    invalid(GeneratorOutputContractV1, { wordCount: 0, streamedTokens: 0 });
  });

  it('rejects negative streamedTokens', () => {
    invalid(GeneratorOutputContractV1, { wordCount: 100, streamedTokens: -1 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent contracts — OptimizerInputContractV1 / OptimizerOutputContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('OptimizerInputContractV1', () => {
  const base = { jobId: 'j1', draftContent: 'Draft text here.', citations: ['file.pdf'] };

  it('accepts valid input', () => {
    expect(() => valid(OptimizerInputContractV1, base)).not.toThrow();
  });

  it('rejects empty draftContent', () => {
    invalid(OptimizerInputContractV1, { ...base, draftContent: '' });
  });

  it('accepts empty citations array', () => {
    expect(() => valid(OptimizerInputContractV1, { ...base, citations: [] })).not.toThrow();
  });
});

describe('OptimizerOutputContractV1', () => {
  const base = { seoKeywords: ['kw1', 'kw2'], changesApplied: ['Fixed tone'] };

  it('accepts valid output', () => {
    expect(() => valid(OptimizerOutputContractV1, base)).not.toThrow();
  });

  it('rejects more than 5 seoKeywords', () => {
    invalid(OptimizerOutputContractV1, { ...base, seoKeywords: ['a', 'b', 'c', 'd', 'e', 'f'] });
  });

  it('accepts empty seoKeywords and changesApplied', () => {
    expect(() =>
      valid(OptimizerOutputContractV1, { seoKeywords: [], changesApplied: [] }),
    ).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Agent contracts — QAInputContractV1 / QAOutputContractV1
// ═══════════════════════════════════════════════════════════════════════════════

describe('QAInputContractV1', () => {
  const base = { jobId: 'j1', optimizedContent: 'Final polished content.', targetTone: 'FORMAL' };

  it('accepts valid input', () => {
    expect(() => valid(QAInputContractV1, base)).not.toThrow();
  });

  it('rejects empty optimizedContent', () => {
    invalid(QAInputContractV1, { ...base, optimizedContent: '' });
  });

  it('rejects empty targetTone', () => {
    invalid(QAInputContractV1, { ...base, targetTone: '' });
  });
});

describe('QAOutputContractV1', () => {
  const base = { approved: true, qualityScore: 88, issueCount: 0, corrections: [] };

  it('accepts valid output', () => {
    expect(() => valid(QAOutputContractV1, base)).not.toThrow();
  });

  it('rejects qualityScore > 100', () => {
    invalid(QAOutputContractV1, { ...base, qualityScore: 101 });
  });

  it('rejects qualityScore < 0', () => {
    invalid(QAOutputContractV1, { ...base, qualityScore: -1 });
  });

  it('rejects negative issueCount', () => {
    invalid(QAOutputContractV1, { ...base, issueCount: -1 });
  });

  it('rejects non-integer issueCount', () => {
    invalid(QAOutputContractV1, { ...base, issueCount: 1.5 });
  });
});
