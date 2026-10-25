/**
 * F017 (stage1-autonomy): Таймауты и Watchdog-таймеры воркеров
 * Перезапуск зависших агентных процессов при превышении порога ожидания
 * Operation Code: watchdog_monitor
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F017_FEATURE_ID = "F017" as const;
export const F017_STAGE = "stage1-autonomy" as const;
export const F017_OPERATION_CODE = "watchdog_monitor" as const;
export const F017_CONTRACT_VERSION = "2.0.0" as const;

export type F017WorkerWatchdogTimersExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
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
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F017WorkerWatchdogTimersAuditEntry;
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
  strictValidation: true
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

export function computeF017Digest(rawPayload: string): string {
  return `f017_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F017WorkerWatchdogTimersEngine {
  private readonly config: F017WorkerWatchdogTimersConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F017WorkerWatchdogTimersOutput[] = [];
  private readonly auditLog: F017WorkerWatchdogTimersAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F017WorkerWatchdogTimersOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F017WorkerWatchdogTimersConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F017_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F017WorkerWatchdogTimersConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
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
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F017WorkerWatchdogTimersValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.worker_id).trim().length === 0) {
      throw new F017WorkerWatchdogTimersValidationError("worker_id", "Primary domain attribute 'worker_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      worker_id: input.worker_id,
      elapsed_ms: input.elapsed_ms,
      timeout_limit_ms: input.timeout_limit_ms,
      restart_triggered: input.restart_triggered
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F017WorkerWatchdogTimersValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F017WorkerWatchdogTimersInput): F017WorkerWatchdogTimersOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F017_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        worker_id: input.worker_id,
        elapsed_ms: input.elapsed_ms,
        timeout_limit_ms: input.timeout_limit_ms,
        restart_triggered: input.restart_triggered
      });
      const payloadHash = computeF017Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F017WorkerWatchdogTimersValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F017_FEATURE_ID,
        operationCode: F017_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          worker_id: input.worker_id,
          elapsed_ms: input.elapsed_ms,
          timeout_limit_ms: input.timeout_limit_ms,
          restart_triggered: input.restart_triggered
        }
      });

      const executionId = `exec_f017_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f017_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F017WorkerWatchdogTimersAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F017_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `watchdog_monitor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
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
        resolved_worker_id: kernelResult.resolvedFields.worker_id as string,
        resolved_elapsed_ms: kernelResult.resolvedFields.elapsed_ms as string | number,
        resolved_timeout_limit_ms: kernelResult.resolvedFields.timeout_limit_ms as string | number | boolean | readonly string[],
        resolved_restart_triggered: kernelResult.resolvedFields.restart_triggered as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
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
          : 0
    };
  }

  public getAuditTrail(): readonly F017WorkerWatchdogTimersAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F017WorkerWatchdogTimersOutput[] {
    return [...this.executionHistory];
  }
}

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
    worker_id: "f017_worker_id_seed",
    elapsed_ms: 42,
    timeout_limit_ms: true,
    restart_triggered: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 17 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F017" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_worker_id !== sampleInput.worker_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F017_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
