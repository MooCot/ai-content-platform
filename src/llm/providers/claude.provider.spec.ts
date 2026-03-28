// Mock Anthropic SDK before imports
const mockCreate = jest.fn();
const mockStream = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate, stream: mockStream },
  })),
}));

import { Observable } from 'rxjs';
import { ClaudeProvider } from './claude.provider';
import { LLMProvider } from '../../common/types/domain.types';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

function makeProvider(apiKey = 'test-key') {
  return new ClaudeProvider(
    createMockConfigService({
      'anthropic.apiKey': apiKey,
      'anthropic.defaultModel': 'claude-sonnet-4-6',
    }),
  );
}

const BASE_RESPONSE = {
  content: [{ type: 'text', text: 'Hello from Claude' }],
  usage: { input_tokens: 10, output_tokens: 20 },
};

describe('ClaudeProvider', () => {
  let provider: ClaudeProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = makeProvider();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('has provider = LLMProvider.CLAUDE', () => {
    expect(provider.provider).toBe(LLMProvider.CLAUDE);
  });

  it('lists supported models', () => {
    expect(provider.supportedModels).toContain('claude-sonnet-4-6');
    expect(provider.supportedModels.length).toBeGreaterThan(0);
  });

  // ── embed() ───────────────────────────────────────────────────────────────

  it('embed() throws — Claude does not support embeddings', async () => {
    await expect(provider.embed(['text'])).rejects.toThrow(
      'Claude provider does not support embeddings',
    );
  });

  // ── isAvailable() ─────────────────────────────────────────────────────────

  it('isAvailable() returns true when apiKey is set', async () => {
    expect(await provider.isAvailable()).toBe(true);
  });

  it('isAvailable() returns false when apiKey is empty', async () => {
    const p = makeProvider('');
    expect(await p.isAvailable()).toBe(false);
  });

  // ── complete() ────────────────────────────────────────────────────────────

  it('returns text content from the response', async () => {
    mockCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.content).toBe('Hello from Claude');
    expect(result.provider).toBe(LLMProvider.CLAUDE);
  });

  it('uses defaultModel when no model specified in request', async () => {
    mockCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.model).toBe('claude-sonnet-4-6');
  });

  it('uses the model specified in the request when provided', async () => {
    mockCreate.mockResolvedValue({ ...BASE_RESPONSE });
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Hi' }],
      model: 'claude-opus-4-6',
    });
    expect(result.model).toBe('claude-opus-4-6');
  });

  it('maps usage correctly', async () => {
    mockCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.usage).toEqual({
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
    });
  });

  it('filters system-role messages from the messages array', async () => {
    mockCreate.mockResolvedValue(BASE_RESPONSE);
    await provider.complete({
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
      ],
    });
    const [params] = mockCreate.mock.calls[0];
    const passedMessages: Array<{ role: string }> = params.messages;
    expect(passedMessages.every((m) => m.role !== 'system')).toBe(true);
  });

  it('combines systemPrompt and system messages into the system field', async () => {
    mockCreate.mockResolvedValue(BASE_RESPONSE);
    await provider.complete({
      systemPrompt: 'You are helpful.',
      messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
      ],
    });
    const [params] = mockCreate.mock.calls[0];
    expect(params.system).toContain('You are helpful.');
    expect(params.system).toContain('Be concise.');
  });

  it('extracts tool_use blocks as toolCalls', async () => {
    mockCreate.mockResolvedValue({
      content: [
        { type: 'tool_use', id: 'tc-1', name: 'readability_checker', input: { content: 'text' } },
      ],
      usage: { input_tokens: 5, output_tokens: 5 },
    });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'use tool' }] });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe('readability_checker');
    expect(result.toolCalls![0].arguments).toEqual({ content: 'text' });
  });

  it('returns undefined toolCalls when no tool_use blocks', async () => {
    mockCreate.mockResolvedValue(BASE_RESPONSE);
    const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.toolCalls).toBeUndefined();
  });

  // ── stream() ──────────────────────────────────────────────────────────────

  it('stream() returns an Observable', () => {
    mockStream.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {},
      finalMessage: jest.fn().mockResolvedValue({ usage: { input_tokens: 0, output_tokens: 0 } }),
    });
    const obs = provider.stream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(obs).toBeInstanceOf(Observable);
  });
});
