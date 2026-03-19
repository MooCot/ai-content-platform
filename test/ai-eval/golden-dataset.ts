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
