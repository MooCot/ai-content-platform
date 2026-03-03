import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLM_PROVIDER_TOKEN } from '../common/interfaces/llm-provider.interface';
import { OpenAIProvider } from './providers/openai.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { LLMRouterService } from './llm-router.service';

@Module({
  imports: [ConfigModule],
  providers: [
    OpenAIProvider,
    ClaudeProvider,
    GeminiProvider,
    {
      provide: LLM_PROVIDER_TOKEN,
      useFactory: (
        openai: OpenAIProvider,
        claude: ClaudeProvider,
        gemini: GeminiProvider,
      ) => [openai, claude, gemini],
      inject: [OpenAIProvider, ClaudeProvider, GeminiProvider],
    },
    LLMRouterService,
  ],
  exports: [LLMRouterService],
})
export class LLMModule {}
