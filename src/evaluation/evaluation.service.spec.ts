import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EvaluationService } from './evaluation.service';
import { EvaluationRecordEntity } from './entities/evaluation-record.entity';
import { RelevanceEvaluator } from './evaluators/relevance.evaluator';
import { ToneEvaluator } from './evaluators/tone.evaluator';
import { FactualityEvaluator } from './evaluators/factuality.evaluator';
import { CompositeEvaluator } from './evaluators/composite.evaluator';
import { MemoryService } from '../memory/memory.service';
import { MetricsService } from '../observability/metrics.service';
import { createRepositoryMock } from '../../test/utils/repository.mock';
import { ConfigService } from '@nestjs/config';
import { createMockConfigService } from '../../test/utils/mock-config.service';
import { createAgentContextFixture } from '../../test/fixtures/agent-context.fixture';
import { ContentType, Tone } from '../common/types/domain.types';

function buildResult(overrides = {}) {
  return {
    raw: 'Draft content',
    optimized: 'Optimized content',
    seoKeywords: ['keyword'],
    readabilityScore: 75,
    toneAnalysis: { detected: Tone.TECHNICAL, confidence: 0.9, scores: {} as never },
    wordCount: 200,
    citations: ['source.pdf'],
    ...overrides,
  };
}

describe('EvaluationService', () => {
  let service: EvaluationService;
  let repoMock: ReturnType<typeof createRepositoryMock<EvaluationRecordEntity>>;
  let memoryMock: jest.Mocked<MemoryService>;
  let metricsMock: jest.Mocked<MetricsService>;
  let compositeMock: jest.Mocked<CompositeEvaluator>;
  let relevanceMock: jest.Mocked<RelevanceEvaluator>;
  let toneMock: jest.Mocked<ToneEvaluator>;
  let factualityMock: jest.Mocked<FactualityEvaluator>;

  beforeEach(async () => {
    repoMock = createRepositoryMock<EvaluationRecordEntity>();
    repoMock.create.mockImplementation((dto) => ({ ...dto }) as EvaluationRecordEntity);
    repoMock.save.mockImplementation((e) => Promise.resolve(e as EvaluationRecordEntity));

    relevanceMock = {
      score: jest.fn().mockResolvedValue(0.85),
    } as unknown as jest.Mocked<RelevanceEvaluator>;
    toneMock = {
      score: jest.fn().mockResolvedValue({ score: 0.78, detected: 'TECHNICAL' }),
    } as unknown as jest.Mocked<ToneEvaluator>;
    factualityMock = {
      score: jest.fn().mockResolvedValue({ score: 0.9, supportedClaims: 9, totalClaims: 10 }),
    } as unknown as jest.Mocked<FactualityEvaluator>;
    compositeMock = {
      score: jest.fn().mockReturnValue(0.82),
    } as unknown as jest.Mocked<CompositeEvaluator>;

    memoryMock = {
      record: jest.fn().mockResolvedValue({ id: 'evt-1' }),
      embedAndIndex: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<MemoryService>;

    metricsMock = {
      recordEvaluationScore: jest.fn(),
    } as unknown as jest.Mocked<MetricsService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EvaluationService,
        { provide: getRepositoryToken(EvaluationRecordEntity), useValue: repoMock },
        { provide: RelevanceEvaluator, useValue: relevanceMock },
        { provide: ToneEvaluator, useValue: toneMock },
        { provide: FactualityEvaluator, useValue: factualityMock },
        { provide: CompositeEvaluator, useValue: compositeMock },
        { provide: MemoryService, useValue: memoryMock },
        { provide: MetricsService, useValue: metricsMock },
        { provide: ConfigService, useValue: createMockConfigService() },
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(createMockConfigService())
      .compile();

    service = module.get(EvaluationService);
  });

  // ── evaluate() ────────────────────────────────────────────────────────────

  describe('evaluate() — invariant: fire-and-forget, never throws', () => {
    it('runs all 4 dimension evaluators in parallel', async () => {
      await service.evaluate(createAgentContextFixture(), buildResult());

      expect(relevanceMock.score).toHaveBeenCalled();
      expect(toneMock.score).toHaveBeenCalled();
      expect(factualityMock.score).toHaveBeenCalled();
      expect(compositeMock.score).toHaveBeenCalled();
    });

    it('persists an EvaluationRecordEntity to the database', async () => {
      await service.evaluate(createAgentContextFixture(), buildResult());
      expect(repoMock.save).toHaveBeenCalled();
    });

    it('records a memory event after successful evaluation', async () => {
      await service.evaluate(createAgentContextFixture(), buildResult());
      expect(memoryMock.record).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'generation_complete' }),
      );
    });

    it('calls embedAndIndex when compositeScore >= 0.70 (memory quality gate)', async () => {
      compositeMock.score.mockReturnValue(0.82); // above threshold
      await service.evaluate(createAgentContextFixture(), buildResult());
      expect(memoryMock.embedAndIndex).toHaveBeenCalledWith(
        'evt-1',
        expect.any(String),
        expect.any(String),
      );
    });

    it('does NOT call embedAndIndex when compositeScore < 0.70', async () => {
      compositeMock.score.mockReturnValue(0.6); // below threshold
      await service.evaluate(createAgentContextFixture(), buildResult());
      expect(memoryMock.embedAndIndex).not.toHaveBeenCalled();
    });

    it('records the evaluation score metric', async () => {
      await service.evaluate(createAgentContextFixture(), buildResult());
      expect(metricsMock.recordEvaluationScore).toHaveBeenCalledWith(
        createAgentContextFixture().brandId,
        ContentType.BLOG,
        expect.any(String),
        0.82,
      );
    });

    it('never throws even when a dimension evaluator throws (fire-and-forget)', async () => {
      relevanceMock.score.mockRejectedValue(new Error('evaluator crashed'));
      await expect(
        service.evaluate(createAgentContextFixture(), buildResult()),
      ).resolves.toBeUndefined();
    });

    it('normalises readabilityScore from 0-100 to 0-1', async () => {
      await service.evaluate(createAgentContextFixture(), buildResult({ readabilityScore: 80 }));
      expect(compositeMock.score).toHaveBeenCalledWith(
        expect.objectContaining({ readability: 0.8 }),
      );
    });
  });

  // ── getByBrand() ──────────────────────────────────────────────────────────

  describe('getByBrand()', () => {
    it('delegates to the repository with correct filter', async () => {
      repoMock.find.mockResolvedValue([]);
      await service.getByBrand('brand-1', 10);
      expect(repoMock.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { brandId: 'brand-1' }, take: 10 }),
      );
    });
  });

  // ── compareModels() ───────────────────────────────────────────────────────

  describe('compareModels()', () => {
    it('returns the model with the higher average score as winner', async () => {
      repoMock.find
        .mockResolvedValueOnce([
          { compositeScore: 0.9 },
          { compositeScore: 0.8 },
        ] as EvaluationRecordEntity[]) // modelA
        .mockResolvedValueOnce([
          { compositeScore: 0.7 },
          { compositeScore: 0.6 },
        ] as EvaluationRecordEntity[]); // modelB

      const result = await service.compareModels('brand-1', 'claude', 'gpt-4o');
      expect(result.winner).toBe('claude');
      expect(result.modelA).toBeCloseTo(0.85, 2);
      expect(result.modelB).toBeCloseTo(0.65, 2);
    });

    it('returns 0 and the other model when one model has no records', async () => {
      repoMock.find
        .mockResolvedValueOnce([{ compositeScore: 0.8 }] as EvaluationRecordEntity[])
        .mockResolvedValueOnce([]);

      const result = await service.compareModels('brand-1', 'claude', 'gpt-4o');
      expect(result.modelB).toBe(0);
      expect(result.winner).toBe('claude');
    });
  });
});
