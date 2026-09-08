import type { RuntimeOperationsStatus } from "@cosmora/contracts";
import type { EmergencyStopStore } from "@cosmora/db";
import type { GatewayErrorCode } from "@cosmora/model-gateway";

export type RuntimeFailureCode = GatewayErrorCode | "EMERGENCY_STOP" | "USAGE_LIMIT_EXCEEDED";

const emptyFailures = (): Record<RuntimeFailureCode, number> => ({
  ROUTE_UNAVAILABLE: 0,
  PROVIDER_TIMEOUT: 0,
  PROVIDER_ERROR: 0,
  CIRCUIT_OPEN: 0,
  INTERRUPTED: 0,
  EMERGENCY_STOP: 0,
  USAGE_LIMIT_EXCEEDED: 0
});

export class EmergencyStopActivatedError extends Error {
  constructor() {
    super("Runtime execution stopped by emergency control");
    this.name = "EmergencyStopActivatedError";
  }
}

export class RuntimeMetrics {
  #activeRuns = 0;
  #runsStarted = 0;
  #runsCompleted = 0;
  #runsFailed = 0;
  #runsCancelled = 0;
  #routeAttempts = 0;
  readonly #routeFailures = emptyFailures();
  #lastFailureAt: string | null = null;

  runStarted(): void {
    this.#activeRuns += 1;
    this.#runsStarted += 1;
  }

  runCompleted(): void {
    this.#activeRuns = Math.max(0, this.#activeRuns - 1);
    this.#runsCompleted += 1;
  }

  runFailed(code: RuntimeFailureCode): void {
    this.#activeRuns = Math.max(0, this.#activeRuns - 1);
    this.#runsFailed += 1;
    this.#lastFailureAt = new Date().toISOString();
    if (code === "EMERGENCY_STOP") this.#routeFailures.EMERGENCY_STOP += 1;
  }

  runCancelled(): void {
    this.#activeRuns = Math.max(0, this.#activeRuns - 1);
    this.#runsCancelled += 1;
  }

  routeSelected(): void {
    this.#routeAttempts += 1;
  }

  routeFailed(code: GatewayErrorCode): void {
    this.#routeFailures[code] += 1;
    this.#lastFailureAt = new Date().toISOString();
  }

  snapshot(
    stopStore: EmergencyStopStore,
    activeRuns: number,
    ownerId?: string
  ): RuntimeOperationsStatus {
    const processStop = stopStore.getProcessStop();
    const projectStops = stopStore.countActiveProjectStops(ownerId);
    const alerts: RuntimeOperationsStatus["alerts"] = [];
    if (processStop) {
      alerts.push({
        code: "PROCESS_EMERGENCY_STOP",
        severity: "critical",
        message: "Process-wide model execution is stopped"
      });
    }
    if (projectStops > 0) {
      alerts.push({
        code: "PROJECT_EMERGENCY_STOP",
        severity: "warning",
        message: `${projectStops} project emergency stop${projectStops === 1 ? " is" : "s are"} active`
      });
    }
    if (this.#routeFailures.CIRCUIT_OPEN > 0) {
      alerts.push({
        code: "MODEL_CIRCUIT_OPEN",
        severity: "warning",
        message: "A model route circuit-open rejection was observed during this process lifetime"
      });
    }
    return {
      generated_at: new Date().toISOString(),
      active_runs: Math.max(activeRuns, this.#activeRuns),
      process_stop: processStop,
      active_project_stops: projectStops,
      metrics: {
        runs_started: this.#runsStarted,
        runs_completed: this.#runsCompleted,
        runs_failed: this.#runsFailed,
        runs_cancelled: this.#runsCancelled,
        route_attempts: this.#routeAttempts,
        route_failures: { ...this.#routeFailures },
        last_failure_at: this.#lastFailureAt
      },
      alerts
    };
  }
}
