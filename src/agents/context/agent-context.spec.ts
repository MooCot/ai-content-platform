import { AgentContext } from './agent-context';
import { AgentRole, ContentType, Tone } from '../../common/types/domain.types';
import { createBrandFixture } from '../../../test/fixtures/brand.fixture';

describe('AgentContext', () => {
  let ctx: AgentContext;
  const brand = createBrandFixture();

  beforeEach(() => {
    ctx = new AgentContext({
      jobId: 'job-1',
      brandId: brand.id,
      brandConfig: brand.config,
      topic: 'Vector DBs',
      contentType: ContentType.BLOG,
      correlationId: 'corr-1',
    });
  });

  it('initialises with correct readonly fields', () => {
    expect(ctx.jobId).toBe('job-1');
    expect(ctx.brandId).toBe(brand.id);
    expect(ctx.topic).toBe('Vector DBs');
    expect(ctx.contentType).toBe(ContentType.BLOG);
    expect(ctx.correlationId).toBe('corr-1');
  });

  it('initialises mutable fields to sensible defaults', () => {
    expect(ctx.isCancelled).toBe(false);
    expect(ctx.steps).toHaveLength(0);
    expect(ctx.outline).toHaveLength(0);
    expect(ctx.ragContext).toHaveLength(0);
    expect(ctx.draftContent).toBe('');
    expect(ctx.approved).toBe(false);
  });

  it('defaults correlationId to empty string when omitted', () => {
    const brand = createBrandFixture();
    const noCorr = new AgentContext({
      jobId: 'j',
      brandId: brand.id,
      brandConfig: brand.config,
      topic: 'x',
      contentType: ContentType.BLOG,
    });
    expect(noCorr.correlationId).toBe('');
  });

  describe('recordStep()', () => {
    it('appends a step with a startedAt timestamp', () => {
      ctx.recordStep({
        agent: AgentRole.PLANNER,
        input: { topic: 'test' },
        output: { outline: ['A', 'B'] },
        modelUsed: 'claude',
        durationMs: 500,
        tokens: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      expect(ctx.steps).toHaveLength(1);
      expect(ctx.steps[0].agent).toBe(AgentRole.PLANNER);
      expect(ctx.steps[0].startedAt).toBeInstanceOf(Date);
      expect(ctx.steps[0].durationMs).toBe(500);
    });

    it('accumulates steps from multiple agents in order', () => {
      ctx.recordStep({
        agent: AgentRole.PLANNER,
        input: {},
        output: {},
        modelUsed: 'm',
        durationMs: 100,
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });
      ctx.recordStep({
        agent: AgentRole.RESEARCHER,
        input: {},
        output: {},
        modelUsed: 'm',
        durationMs: 200,
        tokens: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      });

      expect(ctx.steps).toHaveLength(2);
      expect(ctx.steps[0].agent).toBe(AgentRole.PLANNER);
      expect(ctx.steps[1].agent).toBe(AgentRole.RESEARCHER);
    });
  });

  describe('cancel() / checkCancelled()', () => {
    it('sets isCancelled to true', () => {
      ctx.cancel();
      expect(ctx.isCancelled).toBe(true);
    });

    it('checkCancelled throws when context is cancelled', () => {
      ctx.cancel();
      expect(() => ctx.checkCancelled(AgentRole.PLANNER)).toThrow('Pipeline cancelled');
    });

    it('checkCancelled is a no-op when not cancelled', () => {
      expect(() => ctx.checkCancelled(AgentRole.PLANNER)).not.toThrow();
    });
  });

  describe('targetTone default', () => {
    it('defaults to FORMAL', () => {
      expect(ctx.targetTone).toBe(Tone.FORMAL);
    });
  });
});
