import { Observable } from 'rxjs';
import { LLMProvider, TokenUsage } from '../types/domain.types';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LLMCompletionRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMTool[];
  responseFormat?: 'text' | 'json';
  systemPrompt?: string;
}

export interface LLMCompletionResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  usage: TokenUsage;
  model: string;
  provider: LLMProvider;
}

export interface LLMStreamChunk {
  delta: string;
  done: boolean;
  usage?: TokenUsage;
}

export interface ILLMProvider {
  readonly provider: LLMProvider;
  readonly supportedModels: string[];

  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
  stream(request: LLMCompletionRequest): Observable<LLMStreamChunk>;
  embed(texts: string[], model?: string): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

export const LLM_PROVIDER_TOKEN = 'LLM_PROVIDERS';
