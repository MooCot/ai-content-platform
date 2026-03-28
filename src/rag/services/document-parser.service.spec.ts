// Mock pdf-parse before importing service (it requires a native binary in some envs)
jest.mock('pdf-parse', () =>
  jest.fn().mockResolvedValue({
    text: 'Extracted PDF text content.',
    numpages: 3,
    info: { Title: 'My Report', Author: 'Jane Doe' },
  }),
);

import { DocumentParserService } from './document-parser.service';
import * as pdfParse from 'pdf-parse';

describe('DocumentParserService', () => {
  let service: DocumentParserService;
  const mockPdfParse = pdfParse as unknown as jest.Mock;

  beforeEach(() => {
    service = new DocumentParserService();
    mockPdfParse.mockClear();
  });

  // ── Plain text ─────────────────────────────────────────────────────────────

  it('parses plain text files (text/plain)', async () => {
    const buf = Buffer.from('Hello, world!', 'utf-8');
    const result = await service.parse(buf, 'text/plain', 'notes.txt');
    expect(result.text).toBe('Hello, world!');
    expect(result.metadata).toMatchObject({ filename: 'notes.txt' });
  });

  it('parses markdown as plain text (text/markdown)', async () => {
    const buf = Buffer.from('# Title\n\nSome content', 'utf-8');
    const result = await service.parse(buf, 'text/markdown', 'doc.md');
    expect(result.text).toBe('# Title\n\nSome content');
  });

  it('falls back to plain text for unknown MIME types', async () => {
    const buf = Buffer.from('raw content', 'utf-8');
    const result = await service.parse(buf, 'application/octet-stream', 'file.bin');
    expect(result.text).toBe('raw content');
  });

  // ── PDF ────────────────────────────────────────────────────────────────────

  it('parses PDF files (application/pdf)', async () => {
    const buf = Buffer.from('%PDF-1.4 fake', 'utf-8');
    const result = await service.parse(buf, 'application/pdf', 'report.pdf');
    expect(result.text).toBe('Extracted PDF text content.');
    expect(result.pageCount).toBe(3);
    expect(result.metadata).toMatchObject({ title: 'My Report', author: 'Jane Doe' });
  });

  it('calls pdf-parse with the buffer', async () => {
    const buf = Buffer.from('%PDF fake', 'utf-8');
    await service.parse(buf, 'application/pdf', 'doc.pdf');
    expect(mockPdfParse).toHaveBeenCalledWith(buf);
  });

  it('handles PDF with missing info gracefully', async () => {
    mockPdfParse.mockResolvedValueOnce({ text: 'content', numpages: 1, info: null });
    const result = await service.parse(Buffer.from(''), 'application/pdf', 'empty.pdf');
    expect(result.metadata.title).toBe('');
    expect(result.metadata.author).toBe('');
  });

  // ── HTML ───────────────────────────────────────────────────────────────────

  it('extracts body text from HTML (text/html)', async () => {
    const html = '<html><body><p>Hello world</p></body></html>';
    const buf = Buffer.from(html, 'utf-8');
    const result = await service.parse(buf, 'text/html', 'page.html');
    expect(result.text).toContain('Hello world');
  });

  it('removes script and style tags from HTML', async () => {
    const html =
      '<html><body><script>alert(1)</script><p>Content</p><style>.x{}</style></body></html>';
    const buf = Buffer.from(html, 'utf-8');
    const result = await service.parse(buf, 'text/html', 'page.html');
    expect(result.text).not.toContain('alert');
    expect(result.text).not.toContain('.x{}');
    expect(result.text).toContain('Content');
  });

  it('extracts page title from HTML', async () => {
    const html = '<html><head><title>My Page</title></head><body><p>text</p></body></html>';
    const buf = Buffer.from(html, 'utf-8');
    const result = await service.parse(buf, 'text/html', 'page.html');
    expect(result.metadata.title).toBe('My Page');
    expect(result.metadata.filename).toBe('page.html');
  });

  it('parses text/htm as HTML', async () => {
    const html = '<html><body><p>Hello</p></body></html>';
    const buf = Buffer.from(html, 'utf-8');
    const result = await service.parse(buf, 'text/htm', 'page.htm');
    expect(result.text).toContain('Hello');
  });

  it('collapses whitespace in HTML body text', async () => {
    const html = '<html><body><p>Hello   \n  World</p></body></html>';
    const buf = Buffer.from(html, 'utf-8');
    const result = await service.parse(buf, 'text/html', 'page.html');
    // Multiple whitespace/newlines collapsed to single space
    expect(result.text).not.toMatch(/\s{2,}/);
  });
});
