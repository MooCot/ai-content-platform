import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ITool, ToolInput, ToolOutput } from '../../common/interfaces/tool.interface';
import { LLMRouterService } from '../../llm/llm-router.service';
import { LLMProvider } from '../../common/types/domain.types';

const SummaryOutputSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()),
  tldr: z.string().max(280),
});

@Injectable()
export class SummarizerTool implements ITool {
  readonly name = 'summarizer';
  readonly description = 'Produces a concise summary, key points, and TL;DR of content';
  readonly inputSchema = {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Content to summarize' },
      maxLength: {
        type: 'integer',
        description: 'Max summary length in words',
        default: 150,
      },
    },
    required: ['content'],
  };

  constructor(private readonly llmRouter: LLMRouterService) {}

  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const content = input['content'] as string;
      const maxLength = (input['maxLength'] as number) ?? 150;

      const result = await this.llmRouter.completeStructured(
        {
          messages: [
            {
              role: 'user',
              content: `Summarize this content in max ${maxLength} words:\n\n${content}`,
            },
          ],
          systemPrompt: `You are a professional editor. Create a summary and return JSON with:
- summary: concise summary (max ${maxLength} words)
- keyPoints: 3-5 key takeaways as bullet strings
- tldr: one-sentence TL;DR (max 280 chars)

Return only valid JSON.`,
        },
        SummaryOutputSchema,
        { preferredProvider: LLMProvider.CLAUDE },
      );

      return { success: true, result };
    } catch (err) {
      return { success: false, result: null, error: String(err) };
    }
  }
}
