/**
 * F031 (stage1-autonomy): Реестр активных воркеров (Agent Registry)
 * Мониторинг живых процессов, их загрузки и текущих задач в реальном времени
 * Operation Code: worker_registry
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F031_FEATURE_ID = "F031" as const;
export const F031_STAGE = "stage1-autonomy" as const;
export const F031_OPERATION_CODE = "worker_registry" as const;
export const F031_CONTRACT_VERSION = "2.0.0" as const;

export type F031ActiveWorkerRegistryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F031ActiveWorkerRegistryConfig {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly stage: typeof F031_STAGE;
  readonly operationCode: typeof F031_OPERATION_CODE;
  readonly contractVersion: typeof F031_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F031ActiveWorkerRegistryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly instance_id: string;
  readonly assigned_role: string | number;
  readonly cpu_load_pct: string | number | boolean | readonly string[];
  readonly heartbeat_healthy: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F031ActiveWorkerRegistryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F031_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F031ActiveWorkerRegistryOutput {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F031ActiveWorkerRegistryExecutionStatus;
  readonly operationCode: typeof F031_OPERATION_CODE;
  readonly resolved_instance_id: string;
  readonly resolved_assigned_role: string | number;
  readonly resolved_cpu_load_pct: string | number | boolean | readonly string[];
  readonly resolved_heartbeat_healthy: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F031ActiveWorkerRegistryAuditEntry;
}

export interface F031ActiveWorkerRegistryTelemetrySnapshot {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F031_CONFIG: F031ActiveWorkerRegistryConfig = {
  featureId: F031_FEATURE_ID,
  stage: F031_STAGE,
  operationCode: F031_OPERATION_CODE,
  contractVersion: F031_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F031ActiveWorkerRegistryValidationError extends Error {
  public readonly featureId = F031_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F031 Validation Error on '${field}']: ${message}`);
    this.name = "F031ActiveWorkerRegistryValidationError";
    this.field = field;
  }
}

export function computeF031Digest(rawPayload: string): string {
  return `f031_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F031ActiveWorkerRegistryEngine {
  private readonly config: F031ActiveWorkerRegistryConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F031ActiveWorkerRegistryOutput[] = [];
  private readonly auditLog: F031ActiveWorkerRegistryAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F031ActiveWorkerRegistryOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F031ActiveWorkerRegistryConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F031_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F031ActiveWorkerRegistryConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F031ActiveWorkerRegistryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F031ActiveWorkerRegistryValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.instance_id).trim().length === 0) {
      throw new F031ActiveWorkerRegistryValidationError("instance_id", "Primary domain attribute 'instance_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      instance_id: input.instance_id,
      assigned_role: input.assigned_role,
      cpu_load_pct: input.cpu_load_pct,
      heartbeat_healthy: input.heartbeat_healthy
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F031ActiveWorkerRegistryValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F031ActiveWorkerRegistryInput): F031ActiveWorkerRegistryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F031_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        instance_id: input.instance_id,
        assigned_role: input.assigned_role,
        cpu_load_pct: input.cpu_load_pct,
        heartbeat_healthy: input.heartbeat_healthy
      });
      const payloadHash = computeF031Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F031ActiveWorkerRegistryValidationError(
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
        featureId: F031_FEATURE_ID,
        operationCode: F031_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          instance_id: input.instance_id,
          assigned_role: input.assigned_role,
          cpu_load_pct: input.cpu_load_pct,
          heartbeat_healthy: input.heartbeat_healthy
        }
      });

      const executionId = `exec_f031_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f031_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F031ActiveWorkerRegistryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F031_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `worker_registry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F031ActiveWorkerRegistryOutput = {
        featureId: F031_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F031_OPERATION_CODE,
        resolved_instance_id: kernelResult.resolvedFields.instance_id as string,
        resolved_assigned_role: kernelResult.resolvedFields.assigned_role as string | number,
        resolved_cpu_load_pct: kernelResult.resolvedFields.cpu_load_pct as string | number | boolean | readonly string[],
        resolved_heartbeat_healthy: kernelResult.resolvedFields.heartbeat_healthy as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F031ActiveWorkerRegistryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F031_FEATURE_ID,
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

  public getAuditTrail(): readonly F031ActiveWorkerRegistryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F031ActiveWorkerRegistryOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF031Module(): {
  featureId: typeof F031_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F031ActiveWorkerRegistryEngine();
  const sampleInput: F031ActiveWorkerRegistryInput = {
    requestId: "req_verify_f031",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    instance_id: "f031_instance_id_seed",
    assigned_role: 42,
    cpu_load_pct: true,
    heartbeat_healthy: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 31 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F031" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_instance_id !== sampleInput.instance_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F031_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
