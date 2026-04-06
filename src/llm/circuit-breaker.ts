/**
 * Per-provider circuit breaker for the LLM router.
 *
 * State machine:
 *   CLOSED    → normal operation; failures are counted
 *   OPEN      → provider is unavailable; all calls are skipped immediately
 *   HALF_OPEN → one test request is allowed after the cooldown elapses;
 *               success resets to CLOSED, failure reopens the circuit
 */
export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export class ProviderCircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    /** Number of consecutive failures before the circuit opens */
    private readonly failureThreshold: number,
    /** Milliseconds to wait in OPEN state before transitioning to HALF_OPEN */
    private readonly cooldownMs: number,
  ) {}

  /**
   * Returns true when the circuit is OPEN and the provider call should be skipped.
   * Automatically transitions OPEN → HALF_OPEN once the cooldown has elapsed.
   */
  isOpen(): boolean {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = CircuitState.HALF_OPEN;
        return false; // let one test request through
      }
      return true;
    }
    return false;
  }

  /** Call after a successful provider response — resets the circuit to CLOSED */
  recordSuccess(): void {
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  /** Call after a failed provider response — increments count and opens circuit at threshold */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }
}
