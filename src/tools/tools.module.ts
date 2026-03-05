import { Module } from '@nestjs/common';
import { SeoKeywordTool } from './tools/seo-keyword.tool';
import { ToneAnalyzerTool } from './tools/tone-analyzer.tool';
import { ReadabilityTool } from './tools/readability.tool';
import { SummarizerTool } from './tools/summarizer.tool';
import { ToolsRegistry } from './tools.registry';
import { TOOLS_TOKEN } from '../common/interfaces/tool.interface';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [LLMModule],
  providers: [
    SeoKeywordTool,
    ToneAnalyzerTool,
    ReadabilityTool,
    SummarizerTool,
    {
      provide: TOOLS_TOKEN,
      useFactory: (
        seo: SeoKeywordTool,
        tone: ToneAnalyzerTool,
        readability: ReadabilityTool,
        summarizer: SummarizerTool,
      ) => [seo, tone, readability, summarizer],
      inject: [SeoKeywordTool, ToneAnalyzerTool, ReadabilityTool, SummarizerTool],
    },
    ToolsRegistry,
  ],
  exports: [ToolsRegistry],
})
export class ToolsModule {}
