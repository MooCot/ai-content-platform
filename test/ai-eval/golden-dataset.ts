/**
 * Golden dataset for AI evaluation regression testing.
 *
 * Each entry defines:
 *   - A fixed topic + contentType + expected tone
 *   - The expected minimum quality thresholds per dimension
 *   - A set of required keywords that must appear in the output
 *   - A promptVersion tag — allows regression detection when prompts change
 *
 * Rules:
 *   - Entries are IMMUTABLE once added (append-only). Never edit existing entries.
 *   - To deprecate an entry, set `disabled: true` and add a comment.
 *   - Bump `promptVersion` in EvaluationService when prompts change and add new entries.
 */

import { ContentType, Tone } from '../../src/common/types/domain.types';

export interface GoldenEntry {
  id: string;
  promptVersion: string;
  topic: string;
  contentType: ContentType;
  expectedTone: Tone;
  thresholds: {
    relevance: number;
    tone: number;
    factuality: number;
    readability: number;
    composite: number;
  };
  /** Keywords that must appear (case-insensitive) in the generated output. */
  requiredKeywords: string[];
  /** Keywords that must NOT appear (hallucination guards). */
  forbiddenPhrases: string[];
  /**
   * When true, this entry tests degraded-pipeline output (OPTIMIZER and QA skipped).
   * Thresholds are set lower to reflect raw draft quality without post-processing.
   */
  degraded?: boolean;
  disabled?: boolean;
}

export const GOLDEN_DATASET: GoldenEntry[] = [
  {
    id: 'gd-001',
    promptVersion: '1.0.0',
    topic: 'Introduction to Vector Databases',
    contentType: ContentType.BLOG,
    expectedTone: Tone.TECHNICAL,
    thresholds: {
      relevance: 0.75,
      tone: 0.70,
      factuality: 0.70,
      readability: 0.65,
      composite: 0.70,
    },
    requiredKeywords: ['vector', 'embedding', 'similarity', 'search'],
    forbiddenPhrases: ['I cannot', 'as an AI', 'I don\'t know'],
  },
  {
    id: 'gd-002',
    promptVersion: '1.0.0',
    topic: 'Benefits of RAG for Enterprise AI',
    contentType: ContentType.BLOG,
    expectedTone: Tone.FORMAL,
    thresholds: {
      relevance: 0.75,
      tone: 0.70,
      factuality: 0.70,
      readability: 0.65,
      composite: 0.70,
    },
    requiredKeywords: ['retrieval', 'augmented', 'generation', 'knowledge base'],
    forbiddenPhrases: ['I cannot', 'hallucination'],
  },
  {
    id: 'gd-003',
    promptVersion: '1.0.0',
    topic: 'Email campaign for cloud storage product launch',
    contentType: ContentType.EMAIL,
    expectedTone: Tone.FRIENDLY,
    thresholds: {
      relevance: 0.70,
      tone: 0.75,
      factuality: 0.65,
      readability: 0.70,
      composite: 0.70,
    },
    requiredKeywords: ['cloud', 'storage'],
    forbiddenPhrases: ['I cannot', 'as an AI'],
  },
  {
    id: 'gd-004',
    promptVersion: '1.0.0',
    topic: 'Social media post about AI content platform launch',
    contentType: ContentType.SOCIAL,
    expectedTone: Tone.CASUAL,
    thresholds: {
      relevance: 0.70,
      tone: 0.70,
      factuality: 0.60,
      readability: 0.75,
      composite: 0.68,
    },
    requiredKeywords: ['AI', 'content'],
    forbiddenPhrases: ['I cannot', 'however'],
  },
  {
    id: 'gd-005',
    promptVersion: '1.0.0',
    topic: 'Landing page for an enterprise AI writing assistant',
    contentType: ContentType.LANDING_PAGE,
    expectedTone: Tone.FORMAL,
    thresholds: {
      relevance: 0.72,
      tone: 0.72,
      factuality: 0.68,
      readability: 0.70,
      composite: 0.70,
    },
    requiredKeywords: ['AI', 'writing', 'enterprise'],
    forbiddenPhrases: ['I cannot', 'as an AI', 'I don\'t know'],
  },
  {
    id: 'gd-006',
    promptVersion: '1.0.0',
    topic: 'Product description for a semantic search API',
    contentType: ContentType.PRODUCT_DESCRIPTION,
    expectedTone: Tone.TECHNICAL,
    thresholds: {
      relevance: 0.73,
      tone: 0.70,
      factuality: 0.72,
      readability: 0.68,
      composite: 0.70,
    },
    requiredKeywords: ['semantic', 'search', 'API'],
    forbiddenPhrases: ['I cannot', 'as an AI', 'unlimited'],
  },
  {
    // Degraded pipeline entry: OPTIMIZER and QA are skipped.
    // Thresholds are lower to reflect raw draft quality without post-processing.
    // Purpose: catch regressions where degradation silently breaks output quality.
    id: 'gd-007',
    promptVersion: '1.0.0',
    topic: 'Introduction to Vector Databases',
    contentType: ContentType.BLOG,
    expectedTone: Tone.TECHNICAL,
    degraded: true,
    thresholds: {
      relevance: 0.68,
      tone: 0.65,
      factuality: 0.65,
      readability: 0.60,
      composite: 0.65,
    },
    requiredKeywords: ['vector', 'embedding', 'search'],
    forbiddenPhrases: ['I cannot', 'as an AI'],
  },
];

/** Returns only active (non-disabled) entries for the given prompt version. */
export function getActiveEntries(promptVersion?: string): GoldenEntry[] {
  return GOLDEN_DATASET.filter(
    (e) =>
      !e.disabled &&
      (promptVersion === undefined || e.promptVersion === promptVersion),
  );
}

/** Returns entries by contentType for model comparison runs. */
export function getEntriesByContentType(type: ContentType): GoldenEntry[] {
  return GOLDEN_DATASET.filter((e) => !e.disabled && e.contentType === type);
}
