import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import Anthropic from '@anthropic-ai/sdk';
import {
  ILLMProvider,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMToolCall,
} from '../../common/interfaces/llm-provider.interface';
import { LLMProvider, TokenUsage } from '../../common/types/domain.types';
import { AppConfig } from '../../common/config/configuration';

@Injectable()
export class ClaudeProvider implements ILLMProvider {
  readonly provider = LLMProvider.CLAUDE;
  readonly supportedModels = [
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-3-5-sonnet-20241022',
    'claude-haiku-4-5-20251001',
  ];

  private readonly client: Anthropic;
  private readonly defaultModel: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.client = new Anthropic({
      apiKey: this.config.get('anthropic.apiKey', { infer: true }),
    });
    this.defaultModel = this.config.get('anthropic.defaultModel', { infer: true });
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const systemPrompt = this.buildSystemPrompt(request);

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      system: systemPrompt,
      messages: request.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    };

    // Build final params — tools API exists at runtime but types vary across SDK patch versions
    const finalParams = {
      ...params,
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters as Record<string, unknown>,
            })),
          }
        : {}),
    };

    const response = await this.client.messages.create(
      finalParams as Anthropic.MessageCreateParamsNonStreaming,
    );

    // SDK 0.20.x types response.content as TextBlock[] — cast to access tool-use blocks at runtime
    type AnyBlock = { type: string; id?: string; name?: string; input?: unknown; text?: string };
    const blocks = response.content as unknown as AnyBlock[];

    const toolCalls: LLMToolCall[] = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b) => ({
        id: b.id ?? '',
        name: b.name ?? '',
        arguments: (b.input ?? {}) as Record<string, unknown>,
      }));

    const textContent = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');

    const usage: TokenUsage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    return {
      content: textContent,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage,
      model,
      provider: this.provider,
    };
  }

  stream(request: LLMCompletionRequest): Observable<LLMStreamChunk> {
    const subject = new Subject<LLMStreamChunk>();
    const model = request.model ?? this.defaultModel;
    const systemPrompt = this.buildSystemPrompt(request);

    void (async () => {
      try {
        const stream = this.client.messages.stream({
          model,
          max_tokens: request.maxTokens ?? 4096,
          system: systemPrompt,
          messages: request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            subject.next({ delta: event.delta.text, done: false });
          }
          if (event.type === 'message_stop') {
            const final = await stream.finalMessage();
            subject.next({
              delta: '',
              done: true,
              usage: {
                promptTokens: final.usage.input_tokens,
                completionTokens: final.usage.output_tokens,
                totalTokens: final.usage.input_tokens + final.usage.output_tokens,
              },
            });
          }
        }

        subject.complete();
      } catch (err) {
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  async embed(_texts: string[], _model?: string): Promise<number[][]> {
    // Claude does not provide embeddings — delegate to OpenAI in the router
    throw new Error('Claude provider does not support embeddings. Use OpenAI for embeddings.');
  }

  async isAvailable(): Promise<boolean> {
    // SDK 0.20.x does not expose client.models — check API key presence instead
    return Boolean(this.config.get('anthropic.apiKey', { infer: true }));
  }

  private buildSystemPrompt(request: LLMCompletionRequest): string {
    const systemMessages = request.messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n');
    return request.systemPrompt ? `${request.systemPrompt}\n${systemMessages}` : systemMessages;
  }
}
