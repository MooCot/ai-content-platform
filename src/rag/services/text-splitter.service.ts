import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../common/config/configuration';

export interface SplitterOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

@Injectable()
export class TextSplitterService {
  private readonly defaultChunkSize: number;
  private readonly defaultChunkOverlap: number;

  // Ordered by priority — try to split on paragraph, then sentence, then word
  private readonly separators = ['\n\n', '\n', '. ', '! ', '? ', ' ', ''];

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.defaultChunkSize = this.config.get('rag.chunkSize', { infer: true });
    this.defaultChunkOverlap = this.config.get('rag.chunkOverlap', { infer: true });
  }

  split(text: string, options: SplitterOptions = {}): string[] {
    const chunkSize = options.chunkSize ?? this.defaultChunkSize;
    const chunkOverlap = options.chunkOverlap ?? this.defaultChunkOverlap;

    const chunks = this.recursiveSplit(text, this.separators, chunkSize);
    return this.mergeChunksWithOverlap(chunks, chunkSize, chunkOverlap);
  }

  private recursiveSplit(
    text: string,
    separators: string[],
    chunkSize: number,
  ): string[] {
    if (text.length <= chunkSize) return [text];

    const [separator, ...remainingSeparators] = separators;

    if (separator === undefined) return [text];

    const splits = separator ? text.split(separator) : text.split('');

    const chunks: string[] = [];
    for (const split of splits) {
      if (split.length > chunkSize && remainingSeparators.length) {
        chunks.push(...this.recursiveSplit(split, remainingSeparators, chunkSize));
      } else {
        chunks.push(split);
      }
    }

    return chunks.filter((c) => c.trim().length > 0);
  }

  private mergeChunksWithOverlap(
    chunks: string[],
    chunkSize: number,
    overlap: number,
  ): string[] {
    const merged: string[] = [];
    let currentChunk = '';

    for (const chunk of chunks) {
      if (currentChunk.length + chunk.length + 1 <= chunkSize) {
        currentChunk = currentChunk ? `${currentChunk} ${chunk}` : chunk;
      } else {
        if (currentChunk) merged.push(currentChunk.trim());

        // Start new chunk with overlap from previous
        const overlapText = this.getOverlapText(currentChunk, overlap);
        currentChunk = overlapText ? `${overlapText} ${chunk}` : chunk;
      }
    }

    if (currentChunk.trim()) merged.push(currentChunk.trim());

    return merged;
  }

  private getOverlapText(text: string, overlap: number): string {
    if (!text || overlap === 0) return '';
    const words = text.split(' ');
    let overlapText = '';

    for (let i = words.length - 1; i >= 0; i--) {
      const candidate = words.slice(i).join(' ');
      if (candidate.length <= overlap) {
        overlapText = candidate;
      } else {
        break;
      }
    }

    return overlapText;
  }
}
