// Mock Google GenAI SDK before imports
const mockSendMessage = jest.fn();
const mockSendMessageStream = jest.fn();
const mockStartChat = jest.fn();
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn();

jest.mock('@google/generative-ai', () => ({
  __esModule: true,
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
  HarmBlockThreshold: { BLOCK_NONE: 'BLOCK_NONE' },
  HarmCategory: {
    HARM_CATEGORY_HARASSMENT: 'HARM_CATEGORY_HARASSMENT',
    HARM_CATEGORY_HATE_SPEECH: 'HARM_CATEGORY_HATE_SPEECH',
    HARM_CATEGORY_SEXUALLY_EXPLICIT: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
    HARM_CATEGORY_DANGEROUS_CONTENT: 'HARM_CATEGORY_DANGEROUS_CONTENT',
  },
}));

import { Observable } from 'rxjs';
import { GeminiProvider } from './gemini.provider';
import { LLMProvider } from '../../common/types/domain.types';
import { createMockConfigService } from '../../../test/utils/mock-config.service';

function makeProvider() {
  return new GeminiProvider(
    createMockConfigService({
      'google.apiKey': 'test-key',
      'google.defaultModel': 'gemini-1.5-pro',
    }),
  );
}

describe('GeminiProvider', () => {
  let provider: GeminiProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    // Default model mock setup
    mockStartChat.mockReturnValue({
      sendMessage: mockSendMessage,
      sendMessageStream: mockSendMessageStream,
    });
    mockGetGenerativeModel.mockReturnValue({
      startChat: mockStartChat,
      generateContent: mockGenerateContent,
    });
    mockSendMessage.mockResolvedValue({
      response: {
        text: () => 'Gemini response',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
      },
    });

    provider = makeProvider();
  });

  // ── Metadata ──────────────────────────────────────────────────────────────

  it('has provider = LLMProvider.GEMINI', () => {
    expect(provider.provider).toBe(LLMProvider.GEMINI);
  });

  it('lists supported models', () => {
    expect(provider.supportedModels).toContain('gemini-1.5-pro');
  });

  // ── embed() ───────────────────────────────────────────────────────────────

  it('embed() throws — Gemini does not support embeddings', async () => {
    await expect(provider.embed(['text'])).rejects.toThrow('Use OpenAI provider for embeddings.');
  });

  // ── complete() ────────────────────────────────────────────────────────────

  it('returns text content from the response', async () => {
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.content).toBe('Gemini response');
    expect(result.provider).toBe(LLMProvider.GEMINI);
  });

  it('uses defaultModel when no model specified', async () => {
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.model).toBe('gemini-1.5-pro');
  });

  it('maps usage from usageMetadata correctly', async () => {
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 20, totalTokens: 30 });
  });

  it('handles missing usageMetadata gracefully (defaults to 0)', async () => {
    mockSendMessage.mockResolvedValue({
      response: { text: () => 'ok', usageMetadata: undefined },
    });
    const result = await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] });
    expect(result.usage).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
  });

  it('passes systemPrompt as systemInstruction', async () => {
    await provider.complete({
      systemPrompt: 'Be concise.',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const [chatOptions] = mockStartChat.mock.calls[0];
    expect(chatOptions.systemInstruction).toEqual({
      role: 'user',
      parts: [{ text: 'Be concise.' }],
    });
  });

  it('uses last message as the sendMessage argument', async () => {
    await provider.complete({
      messages: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Response' },
        { role: 'user', content: 'Last message' },
      ],
    });
    expect(mockSendMessage).toHaveBeenCalledWith('Last message');
  });

  it('maps previous messages to chat history (assistant → model role)', async () => {
    await provider.complete({
      messages: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' },
      ],
    });
    const [chatOptions] = mockStartChat.mock.calls[0];
    expect(chatOptions.history[0].role).toBe('user');
    expect(chatOptions.history[1].role).toBe('model'); // assistant → model
  });

  it('excludes system messages from history and lastUserMessage', async () => {
    await provider.complete({
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ],
    });
    expect(mockSendMessage).toHaveBeenCalledWith('Hello');
    const [chatOptions] = mockStartChat.mock.calls[0];
    expect(chatOptions.history).toHaveLength(0);
  });

  // ── isAvailable() ─────────────────────────────────────────────────────────

  it('isAvailable() returns true when generateContent("ping") succeeds', async () => {
    mockGenerateContent.mockResolvedValue({});
    expect(await provider.isAvailable()).toBe(true);
  });

  it('isAvailable() returns false when generateContent throws', async () => {
    mockGenerateContent.mockRejectedValue(new Error('403 forbidden'));
    expect(await provider.isAvailable()).toBe(false);
  });

  // ── stream() ──────────────────────────────────────────────────────────────

  it('stream() returns an Observable', () => {
    mockSendMessageStream.mockResolvedValue({
      stream: (async function* () {
        yield { text: () => 'chunk' };
      })(),
      response: Promise.resolve({ usageMetadata: undefined }),
    });
    const obs = provider.stream({ messages: [{ role: 'user', content: 'hi' }] });
    expect(obs).toBeInstanceOf(Observable);
  });
});
