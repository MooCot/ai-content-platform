import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, Part } from '@google/generative-ai';
import {
  ILLMProvider,
  LLMCompletionRequest,
  LLMCompletionResponse,
  LLMStreamChunk,
} from '../../common/interfaces/llm-provider.interface';
import { LLMProvider } from '../../common/types/domain.types';
import { AppConfig } from '../../common/config/configuration';

@Injectable()
export class GeminiProvider implements ILLMProvider {
  readonly provider = LLMProvider.GEMINI;
  readonly supportedModels = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'];

  private readonly client: GoogleGenerativeAI;
  private readonly defaultModel: string;
  private readonly logger = new Logger(GeminiProvider.name);

  private readonly safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
    {
      category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
    {
      category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
      threshold: HarmBlockThreshold.BLOCK_NONE,
    },
  ];

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.client = new GoogleGenerativeAI(this.config.get('google.apiKey', { infer: true }));
    this.defaultModel = this.config.get('google.defaultModel', { infer: true });
  }

  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse> {
    const modelName = request.model ?? this.defaultModel;
    const model = this.client.getGenerativeModel({
      model: modelName,
      safetySettings: this.safetySettings,
    });

    const { history, lastUserMessage, systemInstruction } = this.buildChat(request);

    type UsageMeta = {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
    const chat = model.startChat({
      history,
      ...(systemInstruction && {
        systemInstruction: { role: 'user', parts: [{ text: systemInstruction }] },
      }),
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 4096,
      },
    });

    const result = await chat.sendMessage(lastUserMessage);
    const response = result.response;
    const text = response.text();
    const usageMeta = (response as unknown as { usageMetadata?: UsageMeta }).usageMetadata;

    return {
      content: text,
      usage: {
        promptTokens: usageMeta?.promptTokenCount ?? 0,
        completionTokens: usageMeta?.candidatesTokenCount ?? 0,
        totalTokens: usageMeta?.totalTokenCount ?? 0,
      },
      model: modelName,
      provider: this.provider,
    };
  }

  stream(request: LLMCompletionRequest): Observable<LLMStreamChunk> {
    const subject = new Subject<LLMStreamChunk>();
    const modelName = request.model ?? this.defaultModel;

    void (async () => {
      try {
        const model = this.client.getGenerativeModel({
          model: modelName,
          safetySettings: this.safetySettings,
        });

        const { history, lastUserMessage, systemInstruction } = this.buildChat(request);
        const chat = model.startChat({
          history,
          ...(systemInstruction && {
            systemInstruction: { role: 'user', parts: [{ text: systemInstruction }] },
          }),
          generationConfig: {
            temperature: request.temperature ?? 0.7,
            maxOutputTokens: request.maxTokens ?? 4096,
          },
        });

        const result = await chat.sendMessageStream(lastUserMessage);

        for await (const chunk of result.stream) {
          subject.next({ delta: chunk.text(), done: false });
        }

        type UsageMeta = {
          promptTokenCount?: number;
          candidatesTokenCount?: number;
          totalTokenCount?: number;
        };
        const final = await result.response;
        const usage = (final as unknown as { usageMetadata?: UsageMeta }).usageMetadata;
        subject.next({
          delta: '',
          done: true,
          usage: {
            promptTokens: usage?.promptTokenCount ?? 0,
            completionTokens: usage?.candidatesTokenCount ?? 0,
            totalTokens: usage?.totalTokenCount ?? 0,
          },
        });

        subject.complete();
      } catch (err) {
        subject.error(err);
      }
    })();

    return subject.asObservable();
  }

  async embed(_texts: string[], _model?: string): Promise<number[][]> {
    throw new Error('Use OpenAI provider for embeddings.');
  }

  async isAvailable(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.defaultModel });
      await model.generateContent('ping');
      return true;
    } catch {
      this.logger.warn('Gemini provider unavailable');
      return false;
    }
  }

  private buildChat(request: LLMCompletionRequest): {
    history: Array<{ role: string; parts: Part[] }>;
    lastUserMessage: string;
    systemInstruction: string;
  } {
    const systemInstruction = request.systemPrompt ?? '';
    const nonSystem = request.messages.filter((m) => m.role !== 'system');

    if (!nonSystem.length) {
      return { history: [], lastUserMessage: '', systemInstruction };
    }

    const last = nonSystem[nonSystem.length - 1];
    const history = nonSystem.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }] as Part[],
    }));

    return {
      history,
      lastUserMessage: last.content,
      systemInstruction,
    };
  }
}
