import { Injectable, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import { load as cheerioLoad } from 'cheerio';

export interface ParsedDocument {
  text: string;
  pageCount?: number;
  metadata: Record<string, string>;
}

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  async parse(buffer: Buffer, mimeType: string, filename: string): Promise<ParsedDocument> {
    switch (mimeType) {
      case 'application/pdf':
        return this.parsePdf(buffer);
      case 'text/plain':
        return this.parsePlainText(buffer, filename);
      case 'text/html':
      case 'text/htm':
        return this.parseHtml(buffer, filename);
      case 'text/markdown':
        return this.parsePlainText(buffer, filename);
      default:
        this.logger.warn(`Unknown MIME type '${mimeType}' — treating as plain text`);
        return this.parsePlainText(buffer, filename);
    }
  }

  private async parsePdf(buffer: Buffer): Promise<ParsedDocument> {
    const data = await pdfParse(buffer);
    return {
      text: data.text,
      pageCount: data.numpages,
      metadata: {
        title: (data.info?.['Title'] as string) ?? '',
        author: (data.info?.['Author'] as string) ?? '',
      },
    };
  }

  private parsePlainText(buffer: Buffer, filename: string): ParsedDocument {
    return {
      text: buffer.toString('utf-8'),
      metadata: { filename },
    };
  }

  private parseHtml(buffer: Buffer, filename: string): ParsedDocument {
    const html = buffer.toString('utf-8');
    const $ = cheerioLoad(html);

    // Remove script/style tags
    $('script, style, nav, footer, header').remove();

    const title = $('title').text().trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim();

    return {
      text,
      metadata: { title, filename },
    };
  }
}
