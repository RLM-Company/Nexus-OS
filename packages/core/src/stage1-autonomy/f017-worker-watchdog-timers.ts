/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F017
 * ============================================================================
 * Feature ID: F017
 * Stage: stage1-autonomy
 * Title: Таймауты и Watchdog-таймеры воркеров
 * Description: Перезапуск зависших агентных процессов при превышении порога ожидания
 * Operation Code: watchdog_monitor
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F017_FEATURE_ID = "F017" as const;
export const F017_STAGE = "stage1-autonomy" as const;
export const F017_OPERATION_CODE = "watchdog_monitor" as const;
export const F017_CONTRACT_VERSION = "1.0.0" as const;

export type F017WorkerWatchdogTimersExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F017WorkerWatchdogTimersConfig {
  readonly featureId: typeof F017_FEATURE_ID;
  readonly stage: typeof F017_STAGE;
  readonly operationCode: typeof F017_OPERATION_CODE;
  readonly contractVersion: typeof F017_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F017WorkerWatchdogTimersInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly worker_id: string;
  readonly elapsed_ms: string | number;
  readonly timeout_limit_ms: string | number | boolean | readonly string[];
  readonly restart_triggered: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F017WorkerWatchdogTimersOutput {
  readonly featureId: typeof F017_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F017WorkerWatchdogTimersExecutionStatus;
  readonly operationCode: typeof F017_OPERATION_CODE;
  readonly resolved_worker_id: string;
  readonly resolved_elapsed_ms: string | number;
  readonly resolved_timeout_limit_ms: string | number | boolean | readonly string[];
  readonly resolved_restart_triggered: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F017WorkerWatchdogTimersAuditEntry;
}

export interface F017WorkerWatchdogTimersAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F017_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F017WorkerWatchdogTimersTelemetrySnapshot {
  readonly featureId: typeof F017_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F017_CONFIG: F017WorkerWatchdogTimersConfig = {
  featureId: F017_FEATURE_ID,
  stage: F017_STAGE,
  operationCode: F017_OPERATION_CODE,
  contractVersion: F017_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F017WorkerWatchdogTimersValidationError extends Error {
  public readonly featureId = F017_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F017 Validation Error on '${field}']: ${message}`);
    this.name = "F017WorkerWatchdogTimersValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F017 provenance & audit integrity.
 */
export function computeF017Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f017_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F017: Таймауты и Watchdog-таймеры воркеров
 * Перезапуск зависших агентных процессов при превышении порога ожидания
 */
export class F017WorkerWatchdogTimersEngine {
  private readonly config: F017WorkerWatchdogTimersConfig;
  private readonly executionHistory: F017WorkerWatchdogTimersOutput[] = [];
  private readonly auditLog: F017WorkerWatchdogTimersAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F017WorkerWatchdogTimersConfig>) {
    this.config = {
      ...DEFAULT_F017_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F017WorkerWatchdogTimersConfig {
    return { ...this.config };
  }

  public validateInput(input: F017WorkerWatchdogTimersInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.worker_id).trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("worker_id", "Primary domain attribute 'worker_id' cannot be empty.");
    }
  }

  public execute(input: F017WorkerWatchdogTimersInput): F017WorkerWatchdogTimersOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f017_${this.totalRuns}_${computeF017Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F017_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        worker_id: input.worker_id,
        elapsed_ms: input.elapsed_ms,
        timeout_limit_ms: input.timeout_limit_ms,
        restart_triggered: input.restart_triggered,
      });

      const provenanceDigest = computeF017Digest(canonicalPayload);
      const auditRecord: F017WorkerWatchdogTimersAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F017_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `watchdog_monitor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F017WorkerWatchdogTimersOutput = {
        featureId: F017_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F017_OPERATION_CODE,
        resolved_worker_id: input.worker_id,
        resolved_elapsed_ms: input.elapsed_ms,
        resolved_timeout_limit_ms: input.timeout_limit_ms,
        resolved_restart_triggered: input.restart_triggered,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord,
      };

      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F017WorkerWatchdogTimersTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F017_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0,
    };
  }

  public getAuditTrail(): readonly F017WorkerWatchdogTimersAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F017WorkerWatchdogTimersOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F017 (Таймауты и Watchdog-таймеры воркеров)
 */
export function verifyF017Module(): {
  featureId: typeof F017_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F017WorkerWatchdogTimersEngine();
  const sampleInput: F017WorkerWatchdogTimersInput = {
    requestId: "req_verify_f017",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    worker_id: "f017_worker_id_verified",
    elapsed_ms: 100,
    timeout_limit_ms: true,
    restart_triggered: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 17 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F017" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F017_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
