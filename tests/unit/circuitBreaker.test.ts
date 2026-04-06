import { describe, it, expect, beforeEach } from "vitest";
import { CircuitBreaker, CircuitState, CircuitBreakerOpenError } from "../../src/lib/circuitBreaker.js";

describe("CircuitBreaker", () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      resetTimeout: 100, // 100ms for fast tests
      successThreshold: 2,
    });
  });

  it("should start in CLOSED state", () => {
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should pass through successful calls in CLOSED state", async () => {
    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should remain CLOSED when failures are below threshold", async () => {
    for (let i = 0; i < 2; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
    }
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should transition to OPEN after reaching failure threshold", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow("fail");
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("should reject calls immediately when OPEN", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }

    // Next call should throw CircuitBreakerOpenError without invoking fn
    let fnCalled = false;
    await expect(
      breaker.execute(() => {
        fnCalled = true;
        return Promise.resolve("ok");
      }),
    ).rejects.toThrow(CircuitBreakerOpenError);
    expect(fnCalled).toBe(false);
  });

  it("should transition to HALF_OPEN after resetTimeout", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150));

    // Next call should go through (HALF_OPEN)
    const result = await breaker.execute(() => Promise.resolve("recovered"));
    expect(result).toBe("recovered");
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);
  });

  it("should close after successThreshold successes in HALF_OPEN", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150));

    // Two successes needed to close (successThreshold: 2)
    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.getState()).toBe(CircuitState.HALF_OPEN);

    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should reopen on failure in HALF_OPEN", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 150));

    // Fail in HALF_OPEN
    await expect(breaker.execute(() => Promise.reject(new Error("still broken")))).rejects.toThrow(
      "still broken",
    );
    expect(breaker.getState()).toBe(CircuitState.OPEN);
  });

  it("should reset failure count on success in CLOSED state", async () => {
    // 2 failures (below threshold)
    await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

    // 1 success resets the count
    await breaker.execute(() => Promise.resolve("ok"));

    // 2 more failures should not trip the breaker (count was reset)
    await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();

    expect(breaker.getState()).toBe(CircuitState.CLOSED);
  });

  it("should support manual reset", async () => {
    // Trip the breaker
    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(() => Promise.reject(new Error("fail")))).rejects.toThrow();
    }
    expect(breaker.getState()).toBe(CircuitState.OPEN);

    breaker.reset();
    expect(breaker.getState()).toBe(CircuitState.CLOSED);

    // Should work normally after reset
    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });
});
