import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Subject, Subscription } from 'rxjs';
import { AppConfig } from '../common/config/configuration';
import { StreamNotFoundException } from '../common/exceptions/domain.exceptions';

export type SSEEventType =
  | 'token'        // single token from LLM
  | 'agent_start'  // agent step beginning
  | 'agent_done'   // agent step completed
  | 'job_done'     // full job completed
  | 'error'        // error occurred
  | 'heartbeat';   // keepalive

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
  jobId: string;
}

interface StreamEntry {
  subject: Subject<SSEEvent>;
  subscription?: Subscription;
  res: Response;
  heartbeatTimer: ReturnType<typeof setInterval>;
  timeoutTimer: ReturnType<typeof setTimeout>;
  cancelledAt?: Date;
}

@Injectable()
export class StreamingService {
  private readonly logger = new Logger(StreamingService.name);
  private readonly streams = new Map<string, StreamEntry>();
  private readonly heartbeatIntervalMs: number;
  private readonly maxDurationMs: number;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    this.heartbeatIntervalMs = this.config.get('streaming.heartbeatIntervalMs', { infer: true });
    this.maxDurationMs = this.config.get('streaming.maxDurationMs', { infer: true });
  }

  /**
   * Register an SSE connection. Sets the proper headers and starts heartbeat.
   * Returns a subject to push events into.
   */
  register(streamId: string, res: Response): Subject<SSEEvent> {
    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const subject = new Subject<SSEEvent>();

    const subscription = subject.subscribe({
      next: (event) => this.writeEvent(res, event),
      error: (err: unknown) => {
        this.writeEvent(res, {
          type: 'error',
          data: { message: String(err) },
          jobId: streamId,
        });
        this.close(streamId);
      },
      complete: () => this.close(streamId),
    });

    const heartbeatTimer = setInterval(() => {
      this.writeEvent(res, { type: 'heartbeat', data: {}, jobId: streamId });
    }, this.heartbeatIntervalMs);

    const timeoutTimer = setTimeout(() => {
      this.logger.warn(`Stream ${streamId} timed out after ${this.maxDurationMs}ms`);
      subject.error(new Error('Stream timeout'));
    }, this.maxDurationMs);

    res.on('close', () => {
      this.logger.debug(`Client disconnected: ${streamId}`);
      this.cleanup(streamId);
    });

    this.streams.set(streamId, {
      subject,
      subscription,
      res,
      heartbeatTimer,
      timeoutTimer,
    });

    return subject;
  }

  /** Push an event to a stream. */
  emit(streamId: string, event: SSEEvent): void {
    const entry = this.streams.get(streamId);
    if (!entry) return;
    entry.subject.next(event);
  }

  /** Cancel and close a stream. */
  cancel(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry) throw new StreamNotFoundException(streamId);
    entry.cancelledAt = new Date();
    entry.subject.error(new Error('Stream cancelled by client'));
  }

  /** Check if a stream is active. */
  isActive(streamId: string): boolean {
    return this.streams.has(streamId);
  }

  /** Close and clean up a stream (called on completion). */
  close(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry) return;

    try {
      entry.res.write('event: done\ndata: {}\n\n');
      entry.res.end();
    } catch {
      // Client already disconnected
    }

    this.cleanup(streamId);
  }

  private cleanup(streamId: string): void {
    const entry = this.streams.get(streamId);
    if (!entry) return;

    clearInterval(entry.heartbeatTimer);
    clearTimeout(entry.timeoutTimer);
    entry.subscription?.unsubscribe();
    this.streams.delete(streamId);
  }

  private writeEvent(res: Response, event: SSEEvent): void {
    try {
      const data = JSON.stringify(event.data);
      res.write(`event: ${event.type}\ndata: ${data}\n\n`);
    } catch {
      // Client disconnected mid-stream
    }
  }
}
