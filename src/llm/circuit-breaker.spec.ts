import { ProviderCircuitBreaker, CircuitState } from './circuit-breaker';

describe('ProviderCircuitBreaker', () => {
  const THRESHOLD = 3;
  const COOLDOWN_MS = 1_000;

  let cb: ProviderCircuitBreaker;
  let nowSpy: jest.SpyInstance;

  beforeEach(() => {
    cb = new ProviderCircuitBreaker(THRESHOLD, COOLDOWN_MS);
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  // ── Initial state ───────────────────────────────────────────────────────

  it('starts in CLOSED state', () => {
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  it('isOpen() returns false when CLOSED', () => {
    expect(cb.isOpen()).toBe(false);
  });

  it('failure count starts at 0', () => {
    expect(cb.getFailureCount()).toBe(0);
  });

  // ── Below threshold — stays CLOSED ──────────────────────────────────────

  it('stays CLOSED below the failure threshold', () => {
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.isOpen()).toBe(false);
  });

  it('increments failure count on each recordFailure', () => {
    cb.recordFailure();
    expect(cb.getFailureCount()).toBe(1);
    cb.recordFailure();
    expect(cb.getFailureCount()).toBe(2);
  });

  // ── At threshold — opens ─────────────────────────────────────────────────

  it('opens after reaching the failure threshold', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  it('isOpen() returns true when OPEN and cooldown has not elapsed', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS - 1); // still in cooldown
    expect(cb.isOpen()).toBe(true);
  });

  // ── Cooldown → HALF_OPEN ─────────────────────────────────────────────────

  it('transitions OPEN → HALF_OPEN after cooldown elapses', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS); // exactly at cooldown boundary
    expect(cb.isOpen()).toBe(false); // allows one test request
    expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it('allows exactly one test request through in HALF_OPEN (isOpen returns false once)', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS);
    expect(cb.isOpen()).toBe(false); // test request allowed — transitions to HALF_OPEN
  });

  // ── HALF_OPEN → CLOSED on success ────────────────────────────────────────

  it('resets to CLOSED after a successful call in HALF_OPEN', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS); // trigger HALF_OPEN
    cb.isOpen(); // consume the state transition
    cb.recordSuccess();
    expect(cb.getState()).toBe(CircuitState.CLOSED);
    expect(cb.getFailureCount()).toBe(0);
  });

  it('isOpen() returns false after reset to CLOSED', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS);
    cb.isOpen();
    cb.recordSuccess();
    expect(cb.isOpen()).toBe(false);
  });

  // ── HALF_OPEN → OPEN on failure ──────────────────────────────────────────

  it('reopens the circuit when the test request fails in HALF_OPEN', () => {
    for (let i = 0; i < THRESHOLD; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS);
    cb.isOpen(); // transition to HALF_OPEN
    cb.recordFailure(); // test request failed
    expect(cb.getState()).toBe(CircuitState.OPEN);
  });

  // ── recordSuccess resets from CLOSED ────────────────────────────────────

  it('recordSuccess resets failure count when called in CLOSED state', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getFailureCount()).toBe(0);
    expect(cb.getState()).toBe(CircuitState.CLOSED);
  });

  // ── Accumulating failures beyond threshold ───────────────────────────────

  it('remains OPEN for additional failures beyond the threshold', () => {
    for (let i = 0; i < THRESHOLD + 5; i++) cb.recordFailure();
    nowSpy.mockReturnValue(COOLDOWN_MS - 1);
    expect(cb.getState()).toBe(CircuitState.OPEN);
    expect(cb.isOpen()).toBe(true);
  });
});
