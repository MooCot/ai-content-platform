import { Injectable } from '@nestjs/common';
import { trace, context, SpanStatusCode, type Span, SpanKind } from '@opentelemetry/api';

const TRACER_NAME = 'content-platform';

@Injectable()
export class TracingService {
  private readonly tracer = trace.getTracer(TRACER_NAME);

  /**
   * Start a new span. Caller is responsible for calling endSpan().
   * Use withSpan() if you want automatic lifecycle management.
   */
  startSpan(name: string, attributes: Record<string, string | number> = {}): Span {
    const span = this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes,
    });
    return span;
  }

  /** End a span, recording an error if provided. */
  endSpan(span: Span, error?: Error, extraAttributes: Record<string, string | number> = {}): void {
    if (Object.keys(extraAttributes).length) {
      span.setAttributes(extraAttributes);
    }

    if (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  }

  /**
   * Execute an async function within a span. Automatically ends the span
   * on success or error. Returns the function's result.
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    attributes: Record<string, string | number> = {},
  ): Promise<T> {
    const span = this.startSpan(name, attributes);
    const ctx = trace.setSpan(context.active(), span);

    try {
      const result = await context.with(ctx, () => fn(span));
      this.endSpan(span);
      return result;
    } catch (err) {
      this.endSpan(span, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
  }
}
