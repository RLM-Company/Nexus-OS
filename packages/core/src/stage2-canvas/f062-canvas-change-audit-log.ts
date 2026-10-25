/**
 * F062 (stage2-canvas): Журнал аудита изменений холста
 * Таймлайн того, какой агент или пользователь внёс правку и в какую секунду
 * Operation Code: canvas_audit_timeline
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F062_FEATURE_ID = "F062" as const;
export const F062_STAGE = "stage2-canvas" as const;
export const F062_OPERATION_CODE = "canvas_audit_timeline" as const;
export const F062_CONTRACT_VERSION = "2.0.0" as const;

export type F062CanvasChangeAuditLogExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F062CanvasChangeAuditLogConfig {
  readonly featureId: typeof F062_FEATURE_ID;
  readonly stage: typeof F062_STAGE;
  readonly operationCode: typeof F062_OPERATION_CODE;
  readonly contractVersion: typeof F062_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F062CanvasChangeAuditLogInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly audit_entries_count: string | number;
  readonly last_actor_id: string | number | boolean | readonly string[];
  readonly chronological_events: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F062CanvasChangeAuditLogAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F062_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F062CanvasChangeAuditLogOutput {
  readonly featureId: typeof F062_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F062CanvasChangeAuditLogExecutionStatus;
  readonly operationCode: typeof F062_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_audit_entries_count: string | number;
  readonly resolved_last_actor_id: string | number | boolean | readonly string[];
  readonly resolved_chronological_events: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F062CanvasChangeAuditLogAuditEntry;
}

export interface F062CanvasChangeAuditLogTelemetrySnapshot {
  readonly featureId: typeof F062_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F062_CONFIG: F062CanvasChangeAuditLogConfig = {
  featureId: F062_FEATURE_ID,
  stage: F062_STAGE,
  operationCode: F062_OPERATION_CODE,
  contractVersion: F062_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F062CanvasChangeAuditLogValidationError extends Error {
  public readonly featureId = F062_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F062 Validation Error on '${field}']: ${message}`);
    this.name = "F062CanvasChangeAuditLogValidationError";
    this.field = field;
  }
}

export function computeF062Digest(rawPayload: string): string {
  return `f062_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F062CanvasChangeAuditLogEngine {
  private readonly config: F062CanvasChangeAuditLogConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F062CanvasChangeAuditLogOutput[] = [];
  private readonly auditLog: F062CanvasChangeAuditLogAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F062CanvasChangeAuditLogOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F062CanvasChangeAuditLogConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F062_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F062CanvasChangeAuditLogConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F062CanvasChangeAuditLogInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F062CanvasChangeAuditLogValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F062CanvasChangeAuditLogValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F062CanvasChangeAuditLogValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F062CanvasChangeAuditLogValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F062CanvasChangeAuditLogValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F062CanvasChangeAuditLogValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F062CanvasChangeAuditLogValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      audit_entries_count: input.audit_entries_count,
      last_actor_id: input.last_actor_id,
      chronological_events: input.chronological_events
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F062CanvasChangeAuditLogValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F062CanvasChangeAuditLogInput): F062CanvasChangeAuditLogOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F062_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        audit_entries_count: input.audit_entries_count,
        last_actor_id: input.last_actor_id,
        chronological_events: input.chronological_events
      });
      const payloadHash = computeF062Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F062CanvasChangeAuditLogValidationError(
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
        featureId: F062_FEATURE_ID,
        operationCode: F062_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          audit_entries_count: input.audit_entries_count,
          last_actor_id: input.last_actor_id,
          chronological_events: input.chronological_events
        }
      });

      const executionId = `exec_f062_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f062_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F062CanvasChangeAuditLogAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F062_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `canvas_audit_timeline:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F062CanvasChangeAuditLogOutput = {
        featureId: F062_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F062_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_audit_entries_count: kernelResult.resolvedFields.audit_entries_count as string | number,
        resolved_last_actor_id: kernelResult.resolvedFields.last_actor_id as string | number | boolean | readonly string[],
        resolved_chronological_events: kernelResult.resolvedFields.chronological_events as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F062CanvasChangeAuditLogTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F062_FEATURE_ID,
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

  public getAuditTrail(): readonly F062CanvasChangeAuditLogAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F062CanvasChangeAuditLogOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF062Module(): {
  featureId: typeof F062_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F062CanvasChangeAuditLogEngine();
  const sampleInput: F062CanvasChangeAuditLogInput = {
    requestId: "req_verify_f062",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f062_artifact_id_seed",
    audit_entries_count: 42,
    last_actor_id: true,
    chronological_events: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 62 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F062" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F062_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
