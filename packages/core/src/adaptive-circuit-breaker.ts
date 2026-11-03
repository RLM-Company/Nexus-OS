/**
 * Kosmora / Nexus-OS Adaptive Circuit Breaker, EWMA Latency Tracker & Token Bucket Rate Limiter (Wave 20)
 *
 * Protects model gateway endpoints, Google Drive cloud APIs, and local sub-agents from
 * cascading failures, rate-limit storms (HTTP 429), and latency spikes:
 * 1. Three-State Circuit Breaker (`CLOSED` -> `OPEN` -> `HALF_OPEN` -> `CLOSED`).
 * 2. Exponentially Weighted Moving Average (EWMA) latency telemetry (`L_t = alpha * y_t + (1 - alpha) * L_{t-1}`).
 * 3. Token Bucket burst rate limiter with continuous refill.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold?: number; // Default 3 consecutive failures
  cooldownMs?: number; // Default 5000ms before HALF_OPEN probe
  ewmaAlpha?: number; // Default 0.2
  bucketCapacity?: number; // Default 20 requests
  refillRatePerSec?: number; // Default 5 tokens/sec
}

export interface EndpointTelemetrySnapshot {
  endpointId: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  ewmaLatencyMs: number;
  availableTokens: number;
  lastFailureReason?: string;
}

interface EndpointEntry {
  state: CircuitState;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  openedAtMs: number;
  ewmaLatencyMs: number;
  tokens: number;
  lastRefillMs: number;
  lastFailureReason?: string;
}

export class AdaptiveCircuitBreaker {
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly ewmaAlpha: number;
  private readonly bucketCapacity: number;
  private readonly refillRatePerSec: number;
  private readonly endpoints = new Map<string, EndpointEntry>();

  constructor(config?: CircuitBreakerConfig) {
    this.failureThreshold = config?.failureThreshold ?? 3;
    this.cooldownMs = config?.cooldownMs ?? 5000;
    this.ewmaAlpha = config?.ewmaAlpha ?? 0.2;
    this.bucketCapacity = config?.bucketCapacity ?? 20;
    this.refillRatePerSec = config?.refillRatePerSec ?? 5;
  }

  /**
   * Executes an async operation guarded by the token bucket rate limiter and circuit breaker.
   */
  public async executeGuarded<T>(
    endpointId: string,
    fn: () => Promise<T>,
    nowMs = Date.now()
  ): Promise<T> {
    const entry = this.getOrCreateEndpoint(endpointId, nowMs);
    this.refillBucket(entry, nowMs);

    // 1. Check Circuit State
    if (entry.state === "OPEN") {
      if (nowMs - entry.openedAtMs >= this.cooldownMs) {
        entry.state = "HALF_OPEN";
      } else {
        throw new Error(
          `CIRCUIT_OPEN: Endpoint '${endpointId}' is isolated after ${entry.consecutiveFailures} failures (${entry.lastFailureReason || "unknown"})`
        );
      }
    }

    // 2. Check Token Bucket Rate Limit
    if (entry.tokens < 1.0) {
      throw new Error(`RATE_LIMIT_EXCEEDED: Token bucket exhausted for endpoint '${endpointId}'`);
    }
    entry.tokens -= 1.0;

    const startTime = performance.now();
    try {
      const result = await fn();
      const durationMs = Math.max(0.1, performance.now() - startTime);
      this.recordSuccess(entry, durationMs);
      return result;
    } catch (err: any) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.recordFailure(entry, errMsg, Date.now());
      throw err;
    }
  }

  public getTelemetry(endpointId: string, nowMs = Date.now()): EndpointTelemetrySnapshot {
    const entry = this.getOrCreateEndpoint(endpointId, nowMs);
    this.refillBucket(entry, nowMs);
    if (entry.state === "OPEN" && nowMs - entry.openedAtMs >= this.cooldownMs) {
      entry.state = "HALF_OPEN";
    }
    return {
      endpointId,
      state: entry.state,
      consecutiveFailures: entry.consecutiveFailures,
      totalSuccesses: entry.totalSuccesses,
      totalFailures: entry.totalFailures,
      ewmaLatencyMs: Number(entry.ewmaLatencyMs.toFixed(2)),
      availableTokens: Number(entry.tokens.toFixed(2)),
      lastFailureReason: entry.lastFailureReason
    };
  }

  private recordSuccess(entry: EndpointEntry, latencyMs: number): void {
    entry.totalSuccesses += 1;
    entry.consecutiveFailures = 0;
    entry.state = "CLOSED";
    if (entry.ewmaLatencyMs === 0) {
      entry.ewmaLatencyMs = latencyMs;
    } else {
      entry.ewmaLatencyMs =
        this.ewmaAlpha * latencyMs + (1 - this.ewmaAlpha) * entry.ewmaLatencyMs;
    }
  }

  private recordFailure(entry: EndpointEntry, reason: string, nowMs: number): void {
    entry.totalFailures += 1;
    entry.consecutiveFailures += 1;
    entry.lastFailureReason = reason;

    if (entry.state === "HALF_OPEN" || entry.consecutiveFailures >= this.failureThreshold) {
      entry.state = "OPEN";
      entry.openedAtMs = nowMs;
    }
  }

  private refillBucket(entry: EndpointEntry, nowMs: number): void {
    const elapsedSec = Math.max(0, (nowMs - entry.lastRefillMs) / 1000);
    if (elapsedSec > 0) {
      entry.tokens = Math.min(
        this.bucketCapacity,
        entry.tokens + elapsedSec * this.refillRatePerSec
      );
      entry.lastRefillMs = nowMs;
    }
  }

  private getOrCreateEndpoint(endpointId: string, nowMs: number): EndpointEntry {
    let entry = this.endpoints.get(endpointId);
    if (!entry) {
      entry = {
        state: "CLOSED",
        consecutiveFailures: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        openedAtMs: 0,
        ewmaLatencyMs: 0,
        tokens: this.bucketCapacity,
        lastRefillMs: nowMs
      };
      this.endpoints.set(endpointId, entry);
    }
    return entry;
  }
}
