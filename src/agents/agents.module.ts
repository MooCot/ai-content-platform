import { Module } from '@nestjs/common';
import { PlannerAgent } from './agents/planner.agent';
import { ResearcherAgent } from './agents/researcher.agent';
import { GeneratorAgent } from './agents/generator.agent';
import { OptimizerAgent } from './agents/optimizer.agent';
import { QAAgent } from './agents/qa.agent';
import { AgentOrchestratorService } from './orchestrator/agent-orchestrator.service';
import { LLMModule } from '../llm/llm.module';
import { RAGModule } from '../rag/rag.module';
import { ToolsModule } from '../tools/tools.module';
import { StreamingModule } from '../streaming/streaming.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [LLMModule, RAGModule, ToolsModule, StreamingModule, MemoryModule],
  providers: [
    PlannerAgent,
    ResearcherAgent,
    GeneratorAgent,
    OptimizerAgent,
    QAAgent,
    AgentOrchestratorService,
  ],
  exports: [AgentOrchestratorService],
})
export class AgentsModule {}
