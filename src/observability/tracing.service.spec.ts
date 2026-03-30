import { type Span, SpanStatusCode } from '@opentelemetry/api';

// ── Mock the OTEL API before importing TracingService ─────────────────────────

const mockEnd = jest.fn();
const mockSetStatus = jest.fn();
const mockSetAttributes = jest.fn();
const mockRecordException = jest.fn();
const mockSpan = {
  end: mockEnd,
  setStatus: mockSetStatus,
  setAttributes: mockSetAttributes,
  recordException: mockRecordException,
};

const mockStartSpan = jest.fn().mockReturnValue(mockSpan);
const mockContextWith = jest.fn((ctx: unknown, fn: () => unknown) => fn());

jest.mock('@opentelemetry/api', () => ({
  trace: {
    getTracer: jest.fn(() => ({ startSpan: mockStartSpan })),
    setSpan: jest.fn(() => ({})),
  },
  context: {
    active: jest.fn(() => ({})),
    with: jest.fn((ctx: unknown, fn: () => unknown) => mockContextWith(ctx, fn)),
  },
  SpanStatusCode: { OK: 'OK', ERROR: 'ERROR' },
  SpanKind: { INTERNAL: 0 },
}));

import { TracingService } from './tracing.service';

describe('TracingService', () => {
  let service: TracingService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStartSpan.mockReturnValue(mockSpan);
    mockContextWith.mockImplementation((ctx, fn) => fn());
    service = new TracingService();
  });

  // ── startSpan() ───────────────────────────────────────────────────────────

  it('returns a span from startSpan()', () => {
    const span = service.startSpan('test-span');
    expect(span).toBe(mockSpan);
  });

  it('passes span name and attributes to the tracer', () => {
    service.startSpan('agent.run', { agentId: 'GENERATOR', brandId: 'b1' });
    expect(mockStartSpan).toHaveBeenCalledWith(
      'agent.run',
      expect.objectContaining({ attributes: { agentId: 'GENERATOR', brandId: 'b1' } }),
    );
  });

  // ── endSpan() ─────────────────────────────────────────────────────────────

  it('sets OK status and ends span on success', () => {
    service.endSpan(mockSpan as unknown as Span);
    expect(mockSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('records exception and sets ERROR status when error provided', () => {
    const err = new Error('pipeline failed');
    service.endSpan(mockSpan as unknown as Span, err);
    expect(mockRecordException).toHaveBeenCalledWith(err);
    expect(mockSetStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'pipeline failed',
    });
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('sets extra attributes when provided', () => {
    service.endSpan(mockSpan as unknown as Span, undefined, { tokens: 250 });
    expect(mockSetAttributes).toHaveBeenCalledWith({ tokens: 250 });
  });

  it('does not call setAttributes when extraAttributes is empty', () => {
    service.endSpan(mockSpan as unknown as Span);
    expect(mockSetAttributes).not.toHaveBeenCalled();
  });

  // ── withSpan() ────────────────────────────────────────────────────────────

  it('returns the result of the wrapped function', async () => {
    const result = await service.withSpan('test', async () => 42);
    expect(result).toBe(42);
  });

  it('ends the span after success', async () => {
    await service.withSpan('test', async () => 'ok');
    expect(mockEnd).toHaveBeenCalledTimes(1);
    expect(mockSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
  });

  it('re-throws the error when the wrapped function throws', async () => {
    const err = new Error('agent failed');
    await expect(
      service.withSpan('test', async () => {
        throw err;
      }),
    ).rejects.toThrow('agent failed');
  });

  it('ends the span with ERROR status when the wrapped function throws', async () => {
    const err = new Error('oops');
    await expect(
      service.withSpan('test', async () => {
        throw err;
      }),
    ).rejects.toThrow();
    expect(mockRecordException).toHaveBeenCalledWith(err);
    expect(mockSetStatus).toHaveBeenCalledWith({ code: SpanStatusCode.ERROR, message: 'oops' });
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('passes the span to the wrapped function', async () => {
    const fn = jest.fn().mockResolvedValue('result');
    await service.withSpan('test', fn);
    expect(fn).toHaveBeenCalledWith(mockSpan);
  });

  it('passes attributes to startSpan', async () => {
    await service.withSpan('my.op', async () => null, { key: 'value' });
    expect(mockStartSpan).toHaveBeenCalledWith(
      'my.op',
      expect.objectContaining({ attributes: { key: 'value' } }),
    );
  });
});
