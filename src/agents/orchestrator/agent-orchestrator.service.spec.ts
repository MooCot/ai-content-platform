import { Test, TestingModule } from '@nestjs/testing';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { PlannerAgent } from '../agents/planner.agent';
import { ResearcherAgent } from '../agents/researcher.agent';
import { GeneratorAgent } from '../agents/generator.agent';
import { OptimizerAgent } from '../agents/optimizer.agent';
import { QAAgent } from '../agents/qa.agent';
import { StreamingService } from '../../streaming/streaming.service';
import { DegradationService } from '../../resilience/degradation.service';
import { AgentRole } from '../../common/types/domain.types';
import { createAgentContextFixture } from '../../../test/fixtures/agent-context.fixture';

function buildAgentMock(_role: AgentRole) {
  return { run: jest.fn().mockResolvedValue(undefined) };
}

describe('AgentOrchestratorService', () => {
  let service: AgentOrchestratorService;
  let plannerMock: { run: jest.Mock };
  let researcherMock: { run: jest.Mock };
  let generatorMock: { run: jest.Mock };
  let optimizerMock: { run: jest.Mock };
  let qaMock: { run: jest.Mock };
  let streamingMock: jest.Mocked<StreamingService>;

  beforeEach(async () => {
    plannerMock = buildAgentMock(AgentRole.PLANNER);
    researcherMock = buildAgentMock(AgentRole.RESEARCHER);
    generatorMock = buildAgentMock(AgentRole.GENERATOR);
    optimizerMock = buildAgentMock(AgentRole.OPTIMIZER);
    qaMock = buildAgentMock(AgentRole.QA);
    streamingMock = { emit: jest.fn() } as unknown as jest.Mocked<StreamingService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentOrchestratorService,
        { provide: PlannerAgent, useValue: plannerMock },
        { provide: ResearcherAgent, useValue: researcherMock },
        { provide: GeneratorAgent, useValue: generatorMock },
        { provide: OptimizerAgent, useValue: optimizerMock },
        { provide: QAAgent, useValue: qaMock },
        { provide: StreamingService, useValue: streamingMock },
      ],
    }).compile();

    service = module.get(AgentOrchestratorService);
  });

  // ── pipeline order (invariant) ──────────────────────────────────────────

  it('executes agents in strict order: PLANNER → RESEARCHER → GENERATOR → OPTIMIZER → QA', async () => {
    const order: string[] = [];
    plannerMock.run = jest.fn().mockImplementation(() => {
      order.push('PLANNER');
      return Promise.resolve();
    });
    researcherMock.run = jest.fn().mockImplementation(() => {
      order.push('RESEARCHER');
      return Promise.resolve();
    });
    generatorMock.run = jest.fn().mockImplementation(() => {
      order.push('GENERATOR');
      return Promise.resolve();
    });
    optimizerMock.run = jest.fn().mockImplementation(() => {
      order.push('OPTIMIZER');
      return Promise.resolve();
    });
    qaMock.run = jest.fn().mockImplementation(() => {
      order.push('QA');
      return Promise.resolve();
    });

    await service.run(createAgentContextFixture());
    expect(order).toEqual(['PLANNER', 'RESEARCHER', 'GENERATOR', 'OPTIMIZER', 'QA']);
  });

  it('emits agent_start and agent_done SSE events for each stage', async () => {
    await service.run(createAgentContextFixture());

    const emittedTypes = (streamingMock.emit as jest.Mock).mock.calls.map(
      ([, event]: [string, { type: string }]) => event.type,
    );
    expect(emittedTypes.filter((t) => t === 'agent_start')).toHaveLength(5);
    expect(emittedTypes.filter((t) => t === 'agent_done')).toHaveLength(5);
  });

  it('returns a ContentResult with correct shape', async () => {
    const ctx = createAgentContextFixture();
    const result = await service.run(ctx);

    expect(result).toHaveProperty('raw');
    expect(result).toHaveProperty('optimized');
    expect(result).toHaveProperty('seoKeywords');
    expect(result).toHaveProperty('readabilityScore');
    expect(result).toHaveProperty('wordCount');
    expect(result).toHaveProperty('citations');
  });

  // ── cancellation ──────────────────────────────────────────────────────────

  it('stops pipeline when context is cancelled before RESEARCHER', async () => {
    plannerMock.run = jest.fn().mockImplementation(async (ctx) => {
      ctx.cancel();
    });

    await service.run(createAgentContextFixture());

    expect(researcherMock.run).not.toHaveBeenCalled();
    expect(generatorMock.run).not.toHaveBeenCalled();
  });

  // ── per-agent timeout ──────────────────────────────────────────────────────

  it('rejects when an agent exceeds its timeout budget', async () => {
    jest.useFakeTimers();

    plannerMock.run = jest.fn().mockImplementation(
      () => new Promise<void>((resolve) => setTimeout(resolve, 60_000)), // longer than 30s budget
    );

    const runPromise = service.run(createAgentContextFixture());
    jest.advanceTimersByTime(31_000);

    await expect(runPromise).rejects.toThrow('PLANNER agent timed out');
    jest.useRealTimers();
  }, 10_000);

  it('calls all 5 agent run() methods on a clean pipeline', async () => {
    await service.run(createAgentContextFixture());
    expect(plannerMock.run).toHaveBeenCalledTimes(1);
    expect(researcherMock.run).toHaveBeenCalledTimes(1);
    expect(generatorMock.run).toHaveBeenCalledTimes(1);
    expect(optimizerMock.run).toHaveBeenCalledTimes(1);
    expect(qaMock.run).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Degradation behaviour
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentOrchestratorService — degradation', () => {
  let service: AgentOrchestratorService;
  let plannerMock: { run: jest.Mock };
  let researcherMock: { run: jest.Mock };
  let generatorMock: { run: jest.Mock };
  let optimizerMock: { run: jest.Mock };
  let qaMock: { run: jest.Mock };
  let streamingMock: jest.Mocked<StreamingService>;
  let degradationMock: jest.Mocked<DegradationService>;

  beforeEach(async () => {
    plannerMock = { run: jest.fn().mockResolvedValue(undefined) };
    researcherMock = { run: jest.fn().mockResolvedValue(undefined) };
    generatorMock = { run: jest.fn().mockResolvedValue(undefined) };
    optimizerMock = { run: jest.fn().mockResolvedValue(undefined) };
    qaMock = { run: jest.fn().mockResolvedValue(undefined) };
    streamingMock = { emit: jest.fn() } as unknown as jest.Mocked<StreamingService>;
    degradationMock = {
      isLatencyBudgetExceeded: jest.fn().mockReturnValue(false),
      isQueueOverloaded: jest.fn().mockReturnValue(false),
      ragTimeout: 5_000,
    } as unknown as jest.Mocked<DegradationService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentOrchestratorService,
        { provide: PlannerAgent, useValue: plannerMock },
        { provide: ResearcherAgent, useValue: researcherMock },
        { provide: GeneratorAgent, useValue: generatorMock },
        { provide: OptimizerAgent, useValue: optimizerMock },
        { provide: QAAgent, useValue: qaMock },
        { provide: StreamingService, useValue: streamingMock },
        { provide: DegradationService, useValue: degradationMock },
      ],
    }).compile();

    service = module.get(AgentOrchestratorService);
  });

  // ── Skip optional agents when already degraded ──────────────────────────

  it('skips OPTIMIZER and QA when context is already degraded at pipeline start', async () => {
    const ctx = createAgentContextFixture();
    ctx.degradation.append('queue_overload'); // mark degraded before pipeline

    await service.run(ctx);

    expect(plannerMock.run).toHaveBeenCalledTimes(1);
    expect(researcherMock.run).toHaveBeenCalledTimes(1);
    expect(generatorMock.run).toHaveBeenCalledTimes(1);
    expect(optimizerMock.run).not.toHaveBeenCalled();
    expect(qaMock.run).not.toHaveBeenCalled();
  });

  it('appends optional_agent_skipped when optional agents are skipped due to degradation', async () => {
    const ctx = createAgentContextFixture();
    ctx.degradation.append('rag_timeout');

    await service.run(ctx);

    expect(ctx.degradation.reasons).toContain('optional_agent_skipped');
  });

  it('emits agent_start/agent_done only for the 3 required agents when degraded', async () => {
    const ctx = createAgentContextFixture();
    ctx.degradation.append('queue_overload');

    await service.run(ctx);

    const emitted = (streamingMock.emit as jest.Mock).mock.calls.map(([, e]) => e.type);
    expect(emitted.filter((t) => t === 'agent_start')).toHaveLength(3);
    expect(emitted.filter((t) => t === 'agent_done')).toHaveLength(3);
  });

  // ── Skip optional agents when latency budget exceeded ─────────────────

  it('skips OPTIMIZER and QA when latency budget is exceeded', async () => {
    degradationMock.isLatencyBudgetExceeded.mockReturnValue(true);
    const ctx = createAgentContextFixture();

    await service.run(ctx);

    expect(optimizerMock.run).not.toHaveBeenCalled();
    expect(qaMock.run).not.toHaveBeenCalled();
    expect(ctx.degradation.reasons).toContain('optional_agent_skipped');
  });

  // ── runWithRetry: first fail → contract_retry → second success ─────────

  it('retries optional agent on first failure and appends contract_retry', async () => {
    let callCount = 0;
    optimizerMock.run = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('parse failed'));
      return Promise.resolve();
    });

    const ctx = createAgentContextFixture();
    await service.run(ctx);

    expect(optimizerMock.run).toHaveBeenCalledTimes(2);
    expect(ctx.degradation.reasons).toContain('contract_retry');
  });

  it('continues pipeline after optional agent retry succeeds', async () => {
    let callCount = 0;
    optimizerMock.run = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve();
    });

    const ctx = createAgentContextFixture();
    await service.run(ctx);

    // QA is skipped because ctx is now degraded after contract_retry was appended
    // (isDegraded = true after first OPTIMIZER failure)
    expect(ctx.degradation.reasons).toContain('contract_retry');
  });

  // ── runWithRetry: both attempts fail → optional_agent_skipped ──────────

  it('appends optional_agent_skipped when both retry attempts fail', async () => {
    optimizerMock.run = jest.fn().mockRejectedValue(new Error('always fails'));

    const ctx = createAgentContextFixture();
    await service.run(ctx);

    expect(optimizerMock.run).toHaveBeenCalledTimes(2);
    expect(ctx.degradation.reasons).toContain('contract_retry');
    expect(ctx.degradation.reasons).toContain('optional_agent_skipped');
  });

  it('does not throw when both optional agent attempts fail', async () => {
    optimizerMock.run = jest.fn().mockRejectedValue(new Error('always fails'));
    qaMock.run = jest.fn().mockRejectedValue(new Error('also fails'));

    const ctx = createAgentContextFixture();
    await expect(service.run(ctx)).resolves.toBeDefined();
  });

  // ── ContentResult degradation fields ──────────────────────────────────

  it('returns degraded: true in ContentResult when context is degraded', async () => {
    const ctx = createAgentContextFixture();
    ctx.degradation.append('rag_timeout');

    const result = await service.run(ctx);

    expect(result.degraded).toBe(true);
  });

  it('returns degraded: false in ContentResult on a clean pipeline', async () => {
    const result = await service.run(createAgentContextFixture());
    expect(result.degraded).toBe(false);
  });

  it('returns accumulated degradationReasons in ContentResult', async () => {
    const ctx = createAgentContextFixture();
    ctx.degradation.append('rag_timeout');
    ctx.degradation.append('llm_fallback');

    const result = await service.run(ctx);

    expect(result.degradationReasons).toEqual(
      expect.arrayContaining(['rag_timeout', 'llm_fallback', 'optional_agent_skipped']),
    );
  });

  // ── Content fallbacks when OPTIMIZER is skipped ────────────────────────

  it('falls back optimized to draftContent when OPTIMIZER is skipped', async () => {
    const ctx = createAgentContextFixture();
    ctx.degradation.append('queue_overload'); // skip optional agents
    ctx.optimizedContent = ''; // OPTIMIZER was never run

    const result = await service.run(ctx);

    expect(result.optimized).toBe(ctx.draftContent);
  });

  it('uses optimizedContent in result when OPTIMIZER ran', async () => {
    const ctx = createAgentContextFixture();
    // ctx.optimizedContent is pre-populated by the fixture

    const result = await service.run(ctx);

    expect(result.optimized).toBe(ctx.optimizedContent);
  });
});
