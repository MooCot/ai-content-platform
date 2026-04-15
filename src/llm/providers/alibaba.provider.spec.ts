// Mock OpenAI SDK before imports (Alibaba reuses OpenAI SDK with custom baseURL)
const mockChatCreate = jest.fn();
const mockModelsList = jest.fn();
const mockEmbeddingsCreate = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
    models: { list: mockModelsList },
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

import { Observable } from 'rxjs';
import { AlibabaProvider } from './alibaba.provider';
import { LLMProvider } from '../../common/types/domain.types';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

function makeProvider(overrides: Record<string, unknown> = {}) {
  return new AlibabaProvider(
    createMockConfigService({
      'alibaba.apiKey': 'test-key',
      'alibaba.defaultModel': 'qwen-plus',
      'alibaba.baseUrl': 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      'rag.embeddingDimension': 1024,
      ...overrides,
    }),
  );
}

const BASE_RESPONSE = {
  choices: [{ message: { content: 'Qwen response', tool_calls: null }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
};

describe('AlibabaProvider', () => {
  let provider: AlibabaProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = makeProvider();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('has provider = LLMProvider.ALIBABA', () => {
    expect(provider.provider).toBe(LLMProvider.ALIBABA);
  });

  it('lists supported models', () => {
    expect(provider.supportedModels).toContain('qwen-plus');
    expect(provider.supportedModels.length).toBeGreaterThan(0);
  });

  // ── complete() ────────────────────────────────────────────────────────────

  it('returns text content from the response', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.content).toBe('Qwen response');
    expect(result.provider).toBe(LLMProvider.ALIBABA);
  });

  it('uses defaultModel when no model specified', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.model).toBe('qwen-plus');
  });

  it('uses the model specified in the request', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'qwen-max',
    });
    expect(result.model).toBe('qwen-max');
  });

  it('maps usage correctly', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it('prepends systemPrompt as a system message', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    await provider.complete({
      systemPrompt: 'Be helpful.',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const [params] = mockChatCreate.mock.calls[0];
    expect(params.messages[0]).toEqual({ role: 'system', content: 'Be helpful.' });
    expect(params.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('sets response_format to json_object when responseFormat is "json"', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      responseFormat: 'json',
    });
    const [params] = mockChatCreate.mock.calls[0];
    expect(params.response_format).toEqual({ type: 'json_object' });
  });

  it('extracts tool calls from the response', async () => {
    mockChatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                function: { name: 'seo_tool', arguments: '{"topic":"AI"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'go' }],
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('seo_tool');
    expect(result.toolCalls![0].arguments).toEqual({ topic: 'AI' });
  });

  it('returns undefined toolCalls when no tool_use blocks', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.toolCalls).toBeUndefined();
  });

  // ── embed() ───────────────────────────────────────────────────────────────

  it('delegates embed() to embeddings.create with batching', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Array(1024).fill(0.1) }, { embedding: Array(1024).fill(0.2) }],
    });
    const result = await provider.embed(['text1', 'text2']);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1024);
  });

  it('batches more than 10 texts into separate requests', async () => {
    const texts = Array.from({ length: 15 }, (_, i) => `text-${i}`);
    mockEmbeddingsCreate
      .mockResolvedValueOnce({
        data: Array(10)
          .fill(null)
          .map(() => ({ embedding: Array(1024).fill(0.1) })),
      })
      .mockResolvedValueOnce({
        data: Array(5)
          .fill(null)
          .map(() => ({ embedding: Array(1024).fill(0.2) })),
      });

    const result = await provider.embed(texts);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(15);
  });

  it('clamps dimension to max 1024 for dashscope', async () => {
    const p = makeProvider({ 'rag.embeddingDimension': 1536 });
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Array(1024).fill(0.1) }],
    });
    await p.embed(['text']);
    const [params] = mockEmbeddingsCreate.mock.calls[0];
    expect(params.dimensions).toBe(1024);
  });

  it('uses 512 dimension when configured dimension <= 512', async () => {
    const p = makeProvider({ 'rag.embeddingDimension': 256 });
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Array(512).fill(0.1) }],
    });
    await p.embed(['text']);
    const [params] = mockEmbeddingsCreate.mock.calls[0];
    expect(params.dimensions).toBe(512);
  });

  it('uses 768 dimension when configured dimension is between 513 and 768', async () => {
    const p = makeProvider({ 'rag.embeddingDimension': 700 });
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Array(768).fill(0.1) }],
    });
    await p.embed(['text']);
    const [params] = mockEmbeddingsCreate.mock.calls[0];
    expect(params.dimensions).toBe(768);
  });

  // ── isAvailable() ─────────────────────────────────────────────────────────

  it('isAvailable() returns true when models.list() succeeds', async () => {
    mockModelsList.mockResolvedValue({ data: [] });
    expect(await provider.isAvailable()).toBe(true);
  });

  it('isAvailable() returns false when models.list() throws', async () => {
    mockModelsList.mockRejectedValue(new Error('401 unauthorized'));
    expect(await provider.isAvailable()).toBe(false);
  });

  // ── stream() ──────────────────────────────────────────────────────────────

  it('stream() returns an Observable', () => {
    mockChatCreate.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'chunk' }, finish_reason: null }], usage: null };
        yield { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: null };
      })(),
    );
    const obs = provider.stream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(obs).toBeInstanceOf(Observable);
  });
});
