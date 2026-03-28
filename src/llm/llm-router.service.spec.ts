import { Test, TestingModule } from '@nestjs/testing';
import { LLMRouterService } from './llm-router.service';
import { LLM_PROVIDER_TOKEN } from '../common/interfaces/llm-provider.interface';
import { LLMProvider } from '../common/types/domain.types';
import { LLMProviderExhaustedException } from '../common/exceptions/domain.exceptions';
import {
  createClaudeProviderMock,
  createOpenAIProviderMock,
  createFlakyProvider,
  createFailingProvider,
  MockLLMProvider,
} from '../../test/mocks/llm-provider.mock';
import { ConfigService } from '@nestjs/config';
import { createMockConfigService } from '../../test/utils/mock-config.service';

describe('LLMRouterService', () => {
  let service: LLMRouterService;
  let claudeMock: MockLLMProvider;
  let openaiMock: MockLLMProvider;

  async function buildModule(providers: MockLLMProvider[]): Promise<void> {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LLMRouterService,
        { provide: LLM_PROVIDER_TOKEN, useValue: providers },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(createMockConfigService())
      .compile();

    service = module.get(LLMRouterService);
  }

  beforeEach(async () => {
    claudeMock = createClaudeProviderMock();
    openaiMock = createOpenAIProviderMock();
    await buildModule([claudeMock, openaiMock]);
  });

  // ── complete() ────────────────────────────────────────────────────────────

  describe('complete()', () => {
    it('returns response from the preferred provider', async () => {
      const result = await service.complete(
        { messages: [{ role: 'user', content: 'hello' }] },
        { preferredProvider: LLMProvider.CLAUDE },
      );
      expect(result.provider).toBe(LLMProvider.CLAUDE);
    });

    it('falls back to next provider when preferred fails with retryable error', async () => {
      const flakyGemini = createFlakyProvider(LLMProvider.CLAUDE, 10); // always fails
      const fallbackOpenAI = createOpenAIProviderMock();
      await buildModule([flakyGemini, fallbackOpenAI]);

      // Set fallback chain to claude → openai
      const result = await service.complete({ messages: [{ role: 'user', content: 'hi' }] });
      // Should have fallen back to OpenAI
      expect(result.provider).toBe(LLMProvider.OPENAI);
    });

    it('retries retryable errors before moving to next provider', async () => {
      const completeSpy = jest.fn();
      const flaky = createFlakyProvider(LLMProvider.CLAUDE, 2); // fails first 2 calls
      const originalImpl = flaky.completeImpl.bind(flaky);
      flaky.completeImpl = (req) => {
        completeSpy();
        return originalImpl(req);
      };
      await buildModule([flaky, openaiMock]);

      await service.complete({ messages: [{ role: 'user', content: 'hi' }] });
      // 2 failures + 1 success = 3 calls on claude, then falls through
      expect(completeSpy).toHaveBeenCalledTimes(3);
    });

    it('throws LLMProviderExhaustedException when all providers fail', async () => {
      const failClaude = createFailingProvider(LLMProvider.CLAUDE, 'fatal');
      const failOpenAI = createFailingProvider(LLMProvider.OPENAI, 'fatal');
      await buildModule([failClaude, failOpenAI]);

      await expect(
        service.complete({ messages: [{ role: 'user', content: 'hi' }] }),
      ).rejects.toThrow(LLMProviderExhaustedException);
    });

    it('does NOT retry non-retryable errors', async () => {
      const calls: number[] = [];
      claudeMock.completeImpl = () => {
        calls.push(1);
        throw new Error('invalid request'); // not retryable
      };

      // Falls through to OpenAI on non-retryable error — Claude must not be retried
      await service.complete({ messages: [{ role: 'user', content: 'hi' }] });
      expect(calls.length).toBe(1);
    });
  });

  // ── stream() ──────────────────────────────────────────────────────────────

  describe('stream()', () => {
    it('emits chunks from the active provider', (done) => {
      const chunks: string[] = [];
      service.stream({ messages: [{ role: 'user', content: 'hello' }] }).subscribe({
        next: (chunk) => {
          if (!chunk.done) chunks.push(chunk.delta);
        },
        complete: () => {
          expect(chunks).toContain('Hello ');
          expect(chunks).toContain('world');
          done();
        },
      });
    });

    it('falls back to next provider when stream throws', (done) => {
      claudeMock.streamImpl = () => {
        throw new Error('503 stream unavailable');
      };

      const chunks: string[] = [];
      service.stream({ messages: [{ role: 'user', content: 'hello' }] }).subscribe({
        next: (chunk) => {
          if (!chunk.done) chunks.push(chunk.delta);
        },
        complete: () => {
          // Received chunks from openai fallback
          expect(chunks.length).toBeGreaterThan(0);
          done();
        },
        error: done,
      });
    });
  });

  // ── embed() ───────────────────────────────────────────────────────────────

  describe('embed()', () => {
    it('delegates to the OpenAI provider (invariant: only OpenAI embeds)', async () => {
      const embedSpy = jest.spyOn(openaiMock, 'embed');
      await service.embed(['test text']);
      expect(embedSpy).toHaveBeenCalledWith(['test text']);
    });

    it('returns an embedding matrix with correct shape', async () => {
      const result = await service.embed(['text1', 'text2']);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(1536);
    });

    it('throws if OpenAI provider is not registered', async () => {
      await buildModule([claudeMock]); // no OpenAI
      await expect(service.embed(['text'])).rejects.toThrow('OpenAI provider not registered');
    });
  });

  // ── onFallback callback ───────────────────────────────────────────────────

  describe('onFallback callback', () => {
    it('complete(): does NOT call onFallback when preferred provider succeeds', async () => {
      const onFallback = jest.fn();
      await service.complete(
        { messages: [{ role: 'user', content: 'hello' }] },
        { preferredProvider: LLMProvider.CLAUDE, onFallback },
      );
      expect(onFallback).not.toHaveBeenCalled();
    });

    it('complete(): calls onFallback with the fallback provider key when falling back', async () => {
      const flakyClaudeForever = createFailingProvider(LLMProvider.CLAUDE, 'unavailable');
      await buildModule([flakyClaudeForever, openaiMock]);

      const onFallback = jest.fn();
      await service.complete(
        { messages: [{ role: 'user', content: 'hi' }] },
        { preferredProvider: LLMProvider.CLAUDE, onFallback },
      );

      expect(onFallback).toHaveBeenCalledTimes(1);
      expect(onFallback).toHaveBeenCalledWith(LLMProvider.OPENAI);
    });

    it('complete(): onFallback is optional — no error when omitted', async () => {
      const failingClaude = createFailingProvider(LLMProvider.CLAUDE, 'error');
      await buildModule([failingClaude, openaiMock]);

      // No onFallback in options
      await expect(
        service.complete({ messages: [{ role: 'user', content: 'hi' }] }),
      ).resolves.toBeDefined();
    });

    it('stream(): does NOT call onFallback when preferred provider streams successfully', (done) => {
      const onFallback = jest.fn();
      service.stream({ messages: [{ role: 'user', content: 'hello' }] }, { onFallback }).subscribe({
        complete: () => {
          expect(onFallback).not.toHaveBeenCalled();
          done();
        },
        error: done,
      });
    });

    it('stream(): calls onFallback when streaming falls back to a second provider', (done) => {
      claudeMock.streamImpl = () => {
        throw new Error('503 stream unavailable');
      };

      const onFallback = jest.fn();
      service
        .stream(
          { messages: [{ role: 'user', content: 'hello' }] },
          { preferredProvider: LLMProvider.CLAUDE, onFallback },
        )
        .subscribe({
          complete: () => {
            expect(onFallback).toHaveBeenCalledTimes(1);
            expect(onFallback).toHaveBeenCalledWith(LLMProvider.OPENAI);
            done();
          },
          error: done,
        });
    });
  });

  // ── completeStructured() ──────────────────────────────────────────────────

  describe('completeStructured()', () => {
    it('parses the LLM JSON response through the Zod schema', async () => {
      const { z } = await import('zod');
      const schema = z.object({ name: z.string(), count: z.number() });

      claudeMock.completeImpl = () => ({
        content: '{"name":"test","count":42}',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        model: 'mock',
        provider: LLMProvider.CLAUDE,
      });

      const result = await service.completeStructured(
        { messages: [{ role: 'user', content: 'go' }] },
        schema,
      );
      expect(result).toEqual({ name: 'test', count: 42 });
    });

    it('throws when the LLM returns malformed JSON', async () => {
      const { z } = await import('zod');
      const schema = z.object({ name: z.string() });

      claudeMock.completeImpl = () => ({
        content: 'not json at all',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'mock',
        provider: LLMProvider.CLAUDE,
      });

      await expect(
        service.completeStructured({ messages: [{ role: 'user', content: 'go' }] }, schema),
      ).rejects.toThrow('LLM structured output parse failed');
    });

    it('throws when JSON is valid but fails Zod schema', async () => {
      const { z } = await import('zod');
      const schema = z.object({ count: z.number().min(1) });

      claudeMock.completeImpl = () => ({
        content: '{"count": -5}',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        model: 'mock',
        provider: LLMProvider.CLAUDE,
      });

      await expect(
        service.completeStructured({ messages: [{ role: 'user', content: 'go' }] }, schema),
      ).rejects.toThrow('LLM structured output parse failed');
    });
  });
});
