import { logger } from "../observability/logger.js";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold: number;
  resetTimeout: number;       // ms before transitioning from OPEN to HALF_OPEN
  successThreshold: number;   // successes in HALF_OPEN needed to close
}

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open -- call rejected`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options: CircuitBreakerOptions) {
    this.options = options;
  }

  getState(): CircuitState {
    return this.state;
  }

  reset(): void {
    this.transition(CircuitState.CLOSED);
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime >= this.options.resetTimeout) {
        this.transition(CircuitState.HALF_OPEN);
      } else {
        throw new CircuitBreakerOpenError(this.options.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.options.successThreshold) {
        this.transition(CircuitState.CLOSED);
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      // CLOSED: reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.transition(CircuitState.OPEN);
      this.lastFailureTime = Date.now();
      this.successCount = 0;
    } else {
      // CLOSED
      this.failureCount++;
      if (this.failureCount >= this.options.failureThreshold) {
        this.transition(CircuitState.OPEN);
        this.lastFailureTime = Date.now();
      }
    }
  }

  private transition(newState: CircuitState): void {
    if (this.state !== newState) {
      logger.info(
        { circuitBreaker: this.options.name, from: this.state, to: newState },
        "Circuit breaker state transition",
      );
      this.state = newState;
    }
  }
}

// ─── Pre-configured instances ──────────────────────────────────────────────

export const stripeCircuitBreaker = new CircuitBreaker({
  name: "stripe",
  failureThreshold: 5,
  resetTimeout: 30_000,
  successThreshold: 2,
});

export const emailCircuitBreaker = new CircuitBreaker({
  name: "resend",
  failureThreshold: 3,
  resetTimeout: 60_000,
  successThreshold: 1,
});

export const webhookCircuitBreaker = new CircuitBreaker({
  name: "webhook-delivery",
  failureThreshold: 10,
  resetTimeout: 15_000,
  successThreshold: 3,
});
