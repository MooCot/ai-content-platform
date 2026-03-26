import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { ZodSchema } from 'zod';
import {
  ILLMProvider,
  LLM_PROVIDER_TOKEN,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
} from '../common/interfaces/llm-provider.interface';
import { LLMProvider } from '../common/types/domain.types';
import { LLMProviderExhaustedException } from '../common/exceptions/domain.exceptions';
import { AppConfig } from '../common/config/configuration';

export interface RouterOptions {
  preferredProvider?: LLMProvider;
  /** Force a specific model regardless of provider defaults */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Called when the router falls back to a non-preferred provider.
   * Agents pass `() => ctx.degradation.append('llm_fallback')` here so
   * the pipeline can track provider switches without coupling the router
   * to the agent pipeline.
   */
  onFallback?: (provider: LLMProvider) => void;
}

@Injectable()
export class LLMRouterService {
  private readonly logger = new Logger(LLMRouterService.name);
  private readonly fallbackChain: LLMProvider[];
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly providerMap: Map<LLMProvider, ILLMProvider>;

  constructor(
    @Inject(LLM_PROVIDER_TOKEN) providers: ILLMProvider[],
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.providerMap = new Map(providers.map((p) => [p.provider, p]));
    this.fallbackChain = this.config.get('llmRouter.fallbackChain', {
      infer: true,
    }) as LLMProvider[];
    this.maxRetries = this.config.get('llmRouter.maxRetries', { infer: true });
    this.retryDelayMs = this.config.get('llmRouter.retryDelayMs', { infer: true });
  }

  /** Complete a request with automatic fallback across providers. */
  async complete(
    request: LLMCompletionRequest,
    options: RouterOptions = {},
  ): Promise<LLMCompletionResponse> {
    const chain = this.buildChain(options.preferredProvider);
    const tried: string[] = [];

    for (let chainIdx = 0; chainIdx < chain.length; chainIdx++) {
      const providerKey = chain[chainIdx];
      const provider = this.providerMap.get(providerKey);
      if (!provider) continue;

      // Notify caller that we fell back to a non-preferred provider
      if (chainIdx > 0) {
        options.onFallback?.(providerKey);
      }

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          this.logger.debug(`Attempting ${providerKey} (attempt ${attempt})`);
          return await provider.complete({
            ...request,
            model: options.model ?? request.model,
            temperature: options.temperature ?? request.temperature,
            maxTokens: options.maxTokens ?? request.maxTokens,
          });
        } catch (err) {
          const isRetryable = this.isRetryableError(err);
          this.logger.warn(`${providerKey} attempt ${attempt} failed: ${String(err)}`);

          if (!isRetryable || attempt === this.maxRetries) break;
          await this.delay(this.retryDelayMs * attempt);
        }
      }

      tried.push(providerKey);
    }

    throw new LLMProviderExhaustedException(tried);
  }

  /** Stream with automatic fallback — yields from the first provider that responds. */
  stream(request: LLMCompletionRequest, options: RouterOptions = {}): Observable<LLMStreamChunk> {
    const subject = new Subject<LLMStreamChunk>();
    const chain = this.buildChain(options.preferredProvider);
    const tried: string[] = [];

    void (async () => {
      for (let chainIdx = 0; chainIdx < chain.length; chainIdx++) {
        const providerKey = chain[chainIdx];
        const provider = this.providerMap.get(providerKey);
        if (!provider) continue;

        if (chainIdx > 0) {
          options.onFallback?.(providerKey);
        }

        try {
          await new Promise<void>((resolve, reject) => {
            provider
              .stream({
                ...request,
                model: options.model ?? request.model,
              })
              .subscribe({
                next: (chunk) => subject.next(chunk),
                error: reject,
                complete: resolve,
              });
          });

          subject.complete();
          return;
        } catch (err) {
          this.logger.warn(`Stream failed on ${providerKey}: ${String(err)}`);
          tried.push(providerKey);
        }
      }

      subject.error(new LLMProviderExhaustedException(tried));
    })();

    return subject.asObservable();
  }

  /** Embed using the OpenAI provider (only provider supporting embeddings). */
  async embed(texts: string[]): Promise<number[][]> {
    const provider = this.providerMap.get(LLMProvider.OPENAI);
    if (!provider) throw new Error('OpenAI provider not registered — required for embeddings');
    return provider.embed(texts);
  }

  /**
   * Complete and parse the response through a Zod schema.
   * Enforces JSON response format.
   */
  async completeStructured<T>(
    request: LLMCompletionRequest,
    schema: ZodSchema<T>,
    options: RouterOptions = {},
  ): Promise<T> {
    const response = await this.complete({ ...request, responseFormat: 'json' }, options);

    try {
      const parsed: unknown = JSON.parse(response.content);
      return schema.parse(parsed);
    } catch (err) {
      throw new Error(
        `LLM structured output parse failed: ${String(err)}\nRaw: ${response.content}`,
      );
    }
  }

  private buildChain(preferred?: LLMProvider): LLMProvider[] {
    if (!preferred) return this.fallbackChain;
    return [preferred, ...this.fallbackChain.filter((p) => p !== preferred)];
  }

  private isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      return (
        msg.includes('429') ||
        msg.includes('rate limit') ||
        msg.includes('503') ||
        msg.includes('timeout') ||
        msg.includes('overloaded')
      );
    }
    return false;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
