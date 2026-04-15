import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import OpenAI from 'openai';
import {
  ILLMProvider,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
  LLMToolCall,
} from '../../common/interfaces/llm-provider.interface';
import { LLMProvider } from '../../common/types/domain.types';
import { AppConfig } from '../../common/config/configuration';

/**
 * Alibaba Cloud DashScope provider.
 * DashScope exposes an OpenAI-compatible API — we reuse the OpenAI SDK
 * with a custom baseURL pointing to the DashScope international endpoint.
 *
 * Models: qwen-turbo (fastest), qwen-plus (balanced), qwen-max (best quality)
 * Free tier: 1 M tokens for new accounts (180-day window).
 * Dashboard: https://dashscope-intl.console.aliyun.com/
 */
@Injectable()
export class AlibabaProvider implements ILLMProvider {
  readonly provider = LLMProvider.ALIBABA;
  readonly supportedModels = ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'];

  private readonly client: OpenAI;
  private readonly defaultModel: string;
  private readonly logger = new Logger(AlibabaProvider.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.client = new OpenAI({
      apiKey: this.config.get('alibaba.apiKey', { infer: true }),
      baseURL: this.config.get('alibaba.baseUrl', { infer: true }),
    });
    this.defaultModel = this.config.get('alibaba.defaultModel', { infer: true });
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const model = request.model ?? this.defaultModel;
    const messages = this.buildMessages(request);

    const params: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 4096,
      response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
    };

    if (request.tools?.length) {
      params.tools = request.tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const toolCalls: LLMToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls.length ? toolCalls : undefined,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? 0,
        completionTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      model,
      provider: this.provider,
    };
  }

  stream(request: LLMCompletionRequest): Observable<LLMStreamChunk> {
    const subject = new Subject<LLMStreamChunk>();
    const model = request.model ?? this.defaultModel;
    const messages = this.buildMessages(request);

    void (async () => {
      try {
        const stream = await this.client.chat.completions.create({
          model,
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 4096,
          stream: true,
          stream_options: { include_usage: true },
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          const usage = chunk.usage;
          const done = chunk.choices[0]?.finish_reason != null;

          subject.next({
            delta,
            done,
            usage: usage
              ? {
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                  totalTokens: usage.total_tokens,
                }
              : undefined,
          });

          if (done) break;
        }

        subject.complete();
      } catch (err) {
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  async embed(texts: string[], model?: string): Promise<number[][]> {
    const embModel = model ?? 'text-embedding-v3';
    const dimension = this.config.get('rag.embeddingDimension', { infer: true });
    // DashScope text-embedding-v3 supports [512, 768, 1024]; clamp to max supported
    const supportedDimension = dimension <= 512 ? 512 : dimension <= 768 ? 768 : 1024;
    const response = await this.client.embeddings.create({
      model: embModel,
      input: texts,
      dimensions: supportedDimension,
    } as Parameters<typeof this.client.embeddings.create>[0]);
    return response.data.map((d) => d.embedding);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      this.logger.warn('Alibaba provider unavailable');
      return false;
    }
  }

  private buildMessages(request: LLMCompletionRequest): OpenAI.ChatCompletionMessageParam[] {
    const msgs: OpenAI.ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      msgs.push({ role: 'system', content: request.systemPrompt });
    }
    msgs.push(
      ...request.messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
    );
    return msgs;
  }
}
