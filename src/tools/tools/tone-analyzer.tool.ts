import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { ITool, ToolInput, ToolOutput } from '../../common/interfaces/tool.interface';
import { LLMRouterService } from '../../llm/llm-router.service';
import { Tone, LLMProvider } from '../../common/types/domain.types';

const ToneOutputSchema = z.object({
  detected: z.nativeEnum(Tone),
  confidence: z.number().min(0).max(1),
  scores: z.object({
    [Tone.FORMAL]: z.number(),
    [Tone.CASUAL]: z.number(),
    [Tone.TECHNICAL]: z.number(),
    [Tone.FRIENDLY]: z.number(),
    [Tone.PERSUASIVE]: z.number(),
  }),
  suggestions: z.array(z.string()),
  alignedWithTarget: z.boolean(),
});

@Injectable()
export class ToneAnalyzerTool implements ITool {
  readonly name = 'tone_analyzer';
  readonly description =
    'Analyzes the tone of content and compares it against a target tone';
  readonly inputSchema = {
    type: 'object',
    properties: {
      content: { type: 'string', description: 'Content to analyze' },
      targetTone: {
        type: 'string',
        enum: Object.values(Tone),
        description: 'Desired tone to compare against',
      },
    },
    required: ['content'],
  };

  constructor(private readonly llmRouter: LLMRouterService) {}

  async execute(input: ToolInput): Promise<ToolOutput> {
    try {
      const content = input['content'] as string;
      const targetTone = (input['targetTone'] as Tone) ?? Tone.FORMAL;

      const result = await this.llmRouter.completeStructured(
        {
          messages: [
            {
              role: 'user',
              content: `Analyze the tone of this content. Target tone: ${targetTone}\n\nContent:\n${content}`,
            },
          ],
          systemPrompt: `You are a linguistics expert. Analyze content tone and return JSON with:
- detected: primary detected tone (FORMAL|CASUAL|TECHNICAL|FRIENDLY|PERSUASIVE)
- confidence: confidence score 0-1
- scores: score 0-1 for each tone: FORMAL, CASUAL, TECHNICAL, FRIENDLY, PERSUASIVE
- suggestions: 2-4 specific improvements to better match the target tone
- alignedWithTarget: true if detected tone matches the target

Return only valid JSON.`,
        },
        ToneOutputSchema,
        { preferredProvider: LLMProvider.OPENAI },
      );

      return { success: true, result };
    } catch (err) {
      return { success: false, result: null, error: String(err) };
    }
  }
}
