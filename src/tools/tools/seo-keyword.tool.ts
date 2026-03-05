import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ITool, ToolInput, ToolOutput } from '../../common/interfaces/tool.interface';
import { LLMRouterService } from '../../llm/llm-router.service';
import { LLMProvider } from '../../common/types/domain.types';

const SeoOutputSchema = z.object({
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()),
  longTailKeywords: z.array(z.string()),
  searchIntent: z.enum(['informational', 'transactional', 'navigational', 'commercial']),
  suggestedTitle: z.string(),
  metaDescription: z.string().max(160),
});

export type SeoKeywordOutput = z.infer<typeof SeoOutputSchema>;

@Injectable()
export class SeoKeywordTool implements ITool {
  readonly name = 'seo_keyword_extractor';
  readonly description =
    'Extracts SEO keywords, identifies search intent, and suggests meta title and description for content';
  readonly inputSchema = {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'The content to analyze' },
      topic: { type: 'string', description: 'The main topic of the content' },
    },
    required: ['content'],
  };

  constructor(private readonly llmRouter: LLMRouterService) {}

  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const content = input['content'] as string;
      const topic = (input['topic'] as string) ?? '';

      const result = await this.llmRouter.completeStructured(
        {
          messages: [
            {
              role: 'user',
              content: `Analyze this content and extract SEO data. Topic: ${topic}\n\nContent:\n${content}`,
            },
          ],
          systemPrompt: `You are an SEO expert. Analyze content and return JSON with:
- primaryKeyword: main keyword phrase (2-4 words)
- secondaryKeywords: 5-8 related keywords
- longTailKeywords: 3-5 long-tail keyword phrases
- searchIntent: one of informational|transactional|navigational|commercial
- suggestedTitle: SEO-optimized title (50-60 chars)
- metaDescription: compelling meta description (max 160 chars)

Return only valid JSON.`,
        },
        SeoOutputSchema,
        { preferredProvider: LLMProvider.OPENAI },
      );

      return { success: true, result };
    } catch (err) {
      return { success: false, result: null, error: String(err) };
    }
  }
}
