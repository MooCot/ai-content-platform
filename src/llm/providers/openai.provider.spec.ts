// Mock OpenAI SDK before imports
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
import { OpenAIProvider } from './openai.provider';
import { LLMProvider } from '../../common/types/domain.types';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

function makeProvider() {
  return new OpenAIProvider(
    createMockConfigService({
      'openai.apiKey': 'test-key',
      'openai.defaultModel': 'gpt-4o',
      'openai.embeddingModel': 'text-embedding-ada-002',
    }),
  );
}

const BASE_RESPONSE = {
  choices: [{ message: { content: 'OpenAI response', tool_calls: null }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
};

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = makeProvider();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('has provider = LLMProvider.OPENAI', () => {
    expect(provider.provider).toBe(LLMProvider.OPENAI);
  });

  it('lists supported models', () => {
    expect(provider.supportedModels).toContain('gpt-4o');
  });

  // ── complete() ────────────────────────────────────────────────────────────

  it('returns text content from the response', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('OpenAI response');
    expect(result.provider).toBe(LLMProvider.OPENAI);
  });

  it('uses defaultModel when no model specified', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.model).toBe('gpt-4o');
  });

  it('maps usage correctly', async () => {
    mockChatCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
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
    const result = await provider.complete({ messages: [{ role: 'user', content: 'go' }] });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('seo_tool');
    expect(result.toolCalls![0].arguments).toEqual({ topic: 'AI' });
  });

  // ── embed() ───────────────────────────────────────────────────────────────

  it('delegates embed() to embeddings.create', async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: Array(1536).fill(0.1) }, { embedding: Array(1536).fill(0.2) }],
    });
    const result = await provider.embed(['text1', 'text2']);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      model: 'text-embedding-ada-002',
      input: ['text1', 'text2'],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(1536);
  });

  it('uses custom embedding model when specified', async () => {
    mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: [0.1] }] });
    await provider.embed(['text'], 'text-embedding-3-small');
    const [params] = mockEmbeddingsCreate.mock.calls[0];
    expect(params.model).toBe('text-embedding-3-small');
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
