// ── Infrastructure ────────────────────────────────────────────────────────────
export { ContractRegistryService } from './contract-registry.service';
export { ContractsModule } from './contracts.module';

// ── v1 Agent contracts ────────────────────────────────────────────────────────
export {
  PlannerInputContractV1,
  PlannerOutputContractV1,
  type PlannerInput,
  type PlannerOutput,
} from './v1/agents/planner.contract';

export {
  ResearcherInputContractV1,
  ResearcherOutputContractV1,
  type ResearcherInput,
  type ResearcherOutput,
} from './v1/agents/researcher.contract';

export {
  GeneratorInputContractV1,
  GeneratorOutputContractV1,
  type GeneratorInput,
  type GeneratorOutput,
} from './v1/agents/generator.contract';

export {
  OptimizerInputContractV1,
  OptimizerOutputContractV1,
  type OptimizerInput,
  type OptimizerOutput,
} from './v1/agents/optimizer.contract';

export {
  QAInputContractV1,
  QAOutputContractV1,
  type QAInput,
  type QAOutput,
} from './v1/agents/qa.contract';

// ── v1 Queue contracts ────────────────────────────────────────────────────────
export {
  ContentGenerationJobContractV1,
  type ContentGenerationJob,
} from './v1/queue/content-generation-job.contract';

export {
  ContentResultContractV1,
  JobStateContractV1,
  type ContentResult,
  type JobState,
} from './v1/queue/job-state.contract';

// ── v1 SSE event contracts ────────────────────────────────────────────────────
export {
  SSEEventContractV1,
  type SSEEvent,
  type SSEEventType,
} from './v1/events/sse-events.contract';

// ── v1 RAG contracts ──────────────────────────────────────────────────────────
export {
  DocumentChunkContractV1,
  RetrievalResultContractV1,
  EmbeddingVersionContractV1,
  type DocumentChunk,
  type RetrievalResult,
  type EmbeddingVersion,
} from './v1/rag/retrieval-result.contract';

// ── v1 Evaluation contracts ───────────────────────────────────────────────────
export {
  EvaluationResultContractV1,
  type EvaluationResult,
} from './v1/evaluation/evaluation-result.contract';
