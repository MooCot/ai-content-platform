import { StreamingService, SSEEvent } from './streaming.service';
import { StreamNotFoundException } from '../common/exceptions/domain.exceptions';
import { createMockConfigService } from '../../test/utils/mock-config.service';

/** Minimal mock of Express Response for SSE testing. */
function createMockResponse() {
  const written: string[] = [];
  let ended = false;
  const listeners: Record<string, (() => void)[]> = {};

  return {
    setHeader: jest.fn(),
    flushHeaders: jest.fn(),
    write: jest.fn((data: string) => {
      written.push(data);
      return true;
    }),
    end: jest.fn(() => {
      ended = true;
    }),
    on: jest.fn((event: string, cb: () => void) => {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(cb);
    }),
    _written: written,
    _ended: () => ended,
    _trigger: (event: string) => listeners[event]?.forEach((cb) => cb()),
  };
}

describe('StreamingService', () => {
  let service: StreamingService;
  const HEARTBEAT_MS = 30_000;
  const MAX_DURATION_MS = 300_000;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new StreamingService(
      createMockConfigService({
        'streaming.heartbeatIntervalMs': HEARTBEAT_MS,
        'streaming.maxDurationMs': MAX_DURATION_MS,
      }),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── register() ────────────────────────────────────────────────────────────

  describe('register()', () => {
    it('sets SSE headers and flushes', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
      expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
      expect(res.flushHeaders).toHaveBeenCalled();
    });

    it('marks the stream as active after register', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      expect(service.isActive('stream-1')).toBe(true);
    });

    it('sends a heartbeat event after the heartbeat interval', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      jest.advanceTimersByTime(HEARTBEAT_MS);
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('heartbeat'));
    });
  });

  // ── emit() ────────────────────────────────────────────────────────────────

  describe('emit()', () => {
    it('writes the event to the response', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);

      const event: SSEEvent = {
        type: 'agent_start',
        data: { agent: 'PLANNER' },
        jobId: 'stream-1',
      };
      service.emit('stream-1', event);

      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('agent_start'));
      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('PLANNER'));
    });

    it('is a no-op for unknown stream IDs', () => {
      expect(() =>
        service.emit('nonexistent', { type: 'token', data: {}, jobId: 'x' }),
      ).not.toThrow();
    });
  });

  // ── cancel() ──────────────────────────────────────────────────────────────

  describe('cancel()', () => {
    it('throws StreamNotFoundException for unknown stream IDs', () => {
      expect(() => service.cancel('nonexistent')).toThrow(StreamNotFoundException);
    });

    it('closes the stream when cancelled', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      service.cancel('stream-1');
      // Stream subject should emit an error, leading to cleanup
      expect(service.isActive('stream-1')).toBe(false);
    });
  });

  // ── close() ───────────────────────────────────────────────────────────────

  describe('close()', () => {
    it('writes a done event and ends the response', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      service.close('stream-1');

      expect(res.write).toHaveBeenCalledWith(expect.stringContaining('done'));
      expect(res.end).toHaveBeenCalled();
    });

    it('removes the stream from the active map', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      service.close('stream-1');
      expect(service.isActive('stream-1')).toBe(false);
    });

    it('is a no-op for an already-closed stream', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      service.close('stream-1');
      expect(() => service.close('stream-1')).not.toThrow();
    });
  });

  // ── auto-cleanup on client disconnect ─────────────────────────────────────

  describe('client disconnect', () => {
    it('cleans up the stream when the response close event fires', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      expect(service.isActive('stream-1')).toBe(true);
      res._trigger('close');
      expect(service.isActive('stream-1')).toBe(false);
    });
  });

  // ── timeout ───────────────────────────────────────────────────────────────

  describe('stream timeout', () => {
    it('closes the stream after maxDurationMs', () => {
      const res = createMockResponse();
      service.register('stream-1', res as never);
      jest.advanceTimersByTime(MAX_DURATION_MS);
      expect(service.isActive('stream-1')).toBe(false);
    });
  });
});
