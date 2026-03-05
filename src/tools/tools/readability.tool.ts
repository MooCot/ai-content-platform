import { Injectable } from '@nestjs/common';
import { ITool, ToolInput, ToolOutput } from '../../common/interfaces/tool.interface';

interface ReadabilityResult {
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  averageSentenceLength: number;
  averageSyllablesPerWord: number;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  readingTimeMinutes: number;
  level: 'very_easy' | 'easy' | 'fairly_easy' | 'standard' | 'fairly_difficult' | 'difficult' | 'very_difficult';
  suggestions: string[];
}

@Injectable()
export class ReadabilityTool implements ITool {
  readonly name = 'readability_checker';
  readonly description =
    'Computes readability scores (Flesch-Kincaid) and flags complex sentences';
  readonly inputSchema = {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Content to analyze' },
    },
    required: ['content'],
  };

  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const content = input['content'] as string;
      const result = this.analyze(content);
      return { success: true, result };
    } catch (err) {
      return { success: false, result: null, error: String(err) };
    }
  }

  private analyze(text: string): ReadabilityResult {
    const cleanText = text.replace(/[^\w\s.!?]/g, ' ').trim();
    const sentences = cleanText.split(/[.!?]+/).filter((s) => s.trim().length > 3);
    const words = cleanText.split(/\s+/).filter((w) => w.length > 0);
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);

    const wordCount = words.length;
    const sentenceCount = Math.max(sentences.length, 1);
    const syllableCount = words.reduce((sum, w) => sum + this.countSyllables(w), 0);

    const avgSentenceLength = wordCount / sentenceCount;
    const avgSyllablesPerWord = syllableCount / Math.max(wordCount, 1);

    // Flesch Reading Ease: 206.835 - 1.015*(words/sentences) - 84.6*(syllables/words)
    const fre = 206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord;

    // Flesch-Kincaid Grade Level: 0.39*(words/sentences) + 11.8*(syllables/words) - 15.59
    const fkGrade = 0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59;

    const readingTimeMinutes = Math.ceil(wordCount / 250);
    const level = this.getReadingLevel(fre);
    const suggestions = this.generateSuggestions(avgSentenceLength, fkGrade, fre);

    return {
      fleschKincaidGrade: Math.round(fkGrade * 10) / 10,
      fleschReadingEase: Math.round(Math.max(0, Math.min(100, fre)) * 10) / 10,
      averageSentenceLength: Math.round(avgSentenceLength * 10) / 10,
      averageSyllablesPerWord: Math.round(avgSyllablesPerWord * 100) / 100,
      wordCount,
      sentenceCount,
      paragraphCount: paragraphs.length,
      readingTimeMinutes,
      level,
      suggestions,
    };
  }

  private countSyllables(word: string): number {
    word = word.toLowerCase().replace(/[^a-z]/g, '');
    if (word.length <= 3) return 1;

    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  private getReadingLevel(fre: number): ReadabilityResult['level'] {
    if (fre >= 90) return 'very_easy';
    if (fre >= 80) return 'easy';
    if (fre >= 70) return 'fairly_easy';
    if (fre >= 60) return 'standard';
    if (fre >= 50) return 'fairly_difficult';
    if (fre >= 30) return 'difficult';
    return 'very_difficult';
  }

  private generateSuggestions(avgSentLen: number, grade: number, fre: number): string[] {
    const suggestions: string[] = [];

    if (avgSentLen > 25) {
      suggestions.push(`Average sentence length is ${Math.round(avgSentLen)} words. Aim for under 20.`);
    }
    if (grade > 12) {
      suggestions.push('Content reads at college level. Simplify vocabulary for broader audiences.');
    }
    if (fre < 50) {
      suggestions.push('Use shorter words and sentences to improve readability.');
    }
    if (fre > 80) {
      suggestions.push('Content is very readable — ensure it still conveys necessary depth.');
    }

    return suggestions;
  }
}
