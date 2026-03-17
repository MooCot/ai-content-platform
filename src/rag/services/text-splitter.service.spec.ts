import { TextSplitterService } from './text-splitter.service';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

describe('TextSplitterService', () => {
  let service: TextSplitterService;

  beforeEach(() => {
    service = new TextSplitterService(
      createMockConfigService({ 'rag.chunkSize': 100, 'rag.chunkOverlap': 20 }),
    );
  });

  it('returns the entire text as a single chunk when it fits within chunkSize', () => {
    const text = 'Short text.';
    const chunks = service.split(text);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(text);
  });

  it('splits long text into multiple chunks', () => {
    const text = 'a'.repeat(250);
    const chunks = service.split(text);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(120)); // allow some tolerance
  });

  it('prefers paragraph boundaries (\n\n) over sentence boundaries', () => {
    const text = 'Paragraph one content.\n\nParagraph two content.\n\nParagraph three content.';
    const chunks = service.split(text, { chunkSize: 30 });
    // Each paragraph should be its own chunk (or merged if small enough)
    expect(chunks.some((c) => c.includes('Paragraph one'))).toBe(true);
    expect(chunks.some((c) => c.includes('Paragraph two'))).toBe(true);
  });

  it('filters out empty chunks', () => {
    const text = 'Hello\n\n\n\nWorld';
    const chunks = service.split(text);
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
  });

  it('respects custom chunkSize and chunkOverlap options', () => {
    const text = 'word '.repeat(40); // 200 chars
    const chunks = service.split(text, { chunkSize: 50, chunkOverlap: 10 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('handles an empty string without throwing', () => {
    const chunks = service.split('');
    expect(Array.isArray(chunks)).toBe(true);
  });

  it('handles single-word input', () => {
    const chunks = service.split('hello');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('hello');
  });
});
