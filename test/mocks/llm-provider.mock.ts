import { Observable } from 'rxjs';
import {
  ILLMProvider,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
} from '../../src/common/interfaces/llm-provider.interface';
import { LLMProvider } from '../../src/common/types/domain.types';

const DEFAULT_USAGE = { promptTokens: 100, completionTokens: 50, totalTokens: 150 };

/**
 * Deterministic mock for ILLMProvider.
 * Override `completeImpl` / `streamImpl` / `embedImpl` per test as needed.
 */
export class MockLLMProvider implements ILLMProvider {
  readonly provider: LLMProvider;
  readonly supportedModels: string[];

  completeImpl: (req: LLMCompletionRequest) => LLMCompletionResponse;
  streamImpl: (req: LLMCompletionRequest) => Observable<LLMStreamChunk>;
  embedImpl: (texts: string[]) => number[][];

  constructor(provider: LLMProvider = LLMProvider.CLAUDE) {
    this.provider = provider;
    this.supportedModels = ['mock-model-1'];

    this.completeImpl = (_req) => ({
      content: '{"outline":["Section 1","Section 2","Section 3"],"searchQueries":["query 1","query 2"],"targetTone":"FORMAL","wordCountTarget":500,"keyMessages":["msg1","msg2","msg3"]}',
      usage: DEFAULT_USAGE,
      model: 'mock-model',
      provider: this.provider,
    });

    this.streamImpl = (_req) =>
      new Observable<LLMStreamChunk>((subscriber) => {
        // Emit asynchronously: LLMRouterService uses a Subject, so the caller
        // must subscribe before chunks arrive. Promise.resolve() schedules
        // emission as a microtask, after subscribe() returns.
        Promise.resolve().then(() => {
          subscriber.next({ delta: 'Hello ', done: false });
          subscriber.next({ delta: 'world', done: false });
          subscriber.next({ delta: '', done: true, usage: DEFAULT_USAGE });
          subscriber.complete();
        });
      });

    this.embedImpl = (texts) => texts.map(() => Array(1536).fill(0.1));
  }

  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    return Promise.resolve(this.completeImpl(request));
  }

  stream(request: LLMCompletionRequest): Observable<LLMStreamChunk> {
    return this.streamImpl(request);
  }

  embed(texts: string[]): Promise<number[][]> {
    return Promise.resolve(this.embedImpl(texts));
  }

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/** Factory for the OpenAI mock — the only provider that handles embeddings. */
export function createOpenAIProviderMock(): MockLLMProvider {
  const mock = new MockLLMProvider(LLMProvider.OPENAI);
  mock.supportedModels.push('gpt-4o');
  return mock;
}

/** Factory for the Claude mock. */
export function createClaudeProviderMock(): MockLLMProvider {
  return new MockLLMProvider(LLMProvider.CLAUDE);
}

/** Factory for the Gemini mock. */
export function createGeminiProviderMock(): MockLLMProvider {
  return new MockLLMProvider(LLMProvider.GEMINI);
}

/**
 * Creates a mock provider that throws a retryable error on the first N calls,
 * then succeeds. Used to test fallback/retry logic.
 */
export function createFlakyProvider(
  provider: LLMProvider,
  failTimes: number,
  errorMessage = '429 rate limit exceeded',
): MockLLMProvider {
  const mock = new MockLLMProvider(provider);
  let callCount = 0;
  mock.completeImpl = (req) => {
    callCount++;
    if (callCount <= failTimes) throw new Error(errorMessage);
    return {
      content: 'success after retry',
      usage: DEFAULT_USAGE,
      model: 'mock-model',
      provider,
    };
  };
  return mock;
}

/** Creates a mock provider that always throws a non-retryable error. */
export function createFailingProvider(
  provider: LLMProvider,
  errorMessage = 'fatal error',
): MockLLMProvider {
  const mock = new MockLLMProvider(provider);
  mock.completeImpl = () => {
    throw new Error(errorMessage);
  };
  return mock;
}
