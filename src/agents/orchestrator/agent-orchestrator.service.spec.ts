import { Test, TestingModule } from '@nestjs/testing';
import { AgentOrchestratorService } from './agent-orchestrator.service';
import { PlannerAgent } from '../agents/planner.agent';
import { ResearcherAgent } from '../agents/researcher.agent';
import { GeneratorAgent } from '../agents/generator.agent';
import { OptimizerAgent } from '../agents/optimizer.agent';
import { QAAgent } from '../agents/qa.agent';
import { StreamingService } from '../../streaming/streaming.service';
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

  // ── pipeline order (κ-invariant) ──────────────────────────────────────────

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
