/**
 * F050 (stage2-canvas): Двусторонняя синхронизация правок
 * Учёт ручных исправлений пользователя на Canvas в памяти агента при следующих сообщениях в чате
 * Operation Code: bidirectional_edit_sync
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F050_FEATURE_ID = "F050" as const;
export const F050_STAGE = "stage2-canvas" as const;
export const F050_OPERATION_CODE = "bidirectional_edit_sync" as const;
export const F050_CONTRACT_VERSION = "2.0.0" as const;

export type F050TwoWayManualEditSyncExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F050TwoWayManualEditSyncConfig {
  readonly featureId: typeof F050_FEATURE_ID;
  readonly stage: typeof F050_STAGE;
  readonly operationCode: typeof F050_OPERATION_CODE;
  readonly contractVersion: typeof F050_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F050TwoWayManualEditSyncInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly user_diff_patch: string | number;
  readonly agent_memory_updated: string | number | boolean | readonly string[];
  readonly sync_version: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F050TwoWayManualEditSyncAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F050_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F050TwoWayManualEditSyncOutput {
  readonly featureId: typeof F050_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F050TwoWayManualEditSyncExecutionStatus;
  readonly operationCode: typeof F050_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_user_diff_patch: string | number;
  readonly resolved_agent_memory_updated: string | number | boolean | readonly string[];
  readonly resolved_sync_version: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F050TwoWayManualEditSyncAuditEntry;
}

export interface F050TwoWayManualEditSyncTelemetrySnapshot {
  readonly featureId: typeof F050_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F050_CONFIG: F050TwoWayManualEditSyncConfig = {
  featureId: F050_FEATURE_ID,
  stage: F050_STAGE,
  operationCode: F050_OPERATION_CODE,
  contractVersion: F050_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F050TwoWayManualEditSyncValidationError extends Error {
  public readonly featureId = F050_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F050 Validation Error on '${field}']: ${message}`);
    this.name = "F050TwoWayManualEditSyncValidationError";
    this.field = field;
  }
}

export function computeF050Digest(rawPayload: string): string {
  return `f050_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F050TwoWayManualEditSyncEngine {
  private readonly config: F050TwoWayManualEditSyncConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F050TwoWayManualEditSyncOutput[] = [];
  private readonly auditLog: F050TwoWayManualEditSyncAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F050TwoWayManualEditSyncOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F050TwoWayManualEditSyncConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F050_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F050TwoWayManualEditSyncConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F050TwoWayManualEditSyncInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F050TwoWayManualEditSyncValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F050TwoWayManualEditSyncValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F050TwoWayManualEditSyncValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F050TwoWayManualEditSyncValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F050TwoWayManualEditSyncValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F050TwoWayManualEditSyncValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F050TwoWayManualEditSyncValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      user_diff_patch: input.user_diff_patch,
      agent_memory_updated: input.agent_memory_updated,
      sync_version: input.sync_version
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F050TwoWayManualEditSyncValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F050TwoWayManualEditSyncInput): F050TwoWayManualEditSyncOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F050_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        user_diff_patch: input.user_diff_patch,
        agent_memory_updated: input.agent_memory_updated,
        sync_version: input.sync_version
      });
      const payloadHash = computeF050Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F050TwoWayManualEditSyncValidationError(
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
        featureId: F050_FEATURE_ID,
        operationCode: F050_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          user_diff_patch: input.user_diff_patch,
          agent_memory_updated: input.agent_memory_updated,
          sync_version: input.sync_version
        }
      });

      const executionId = `exec_f050_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f050_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F050TwoWayManualEditSyncAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F050_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `bidirectional_edit_sync:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F050TwoWayManualEditSyncOutput = {
        featureId: F050_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F050_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_user_diff_patch: kernelResult.resolvedFields.user_diff_patch as string | number,
        resolved_agent_memory_updated: kernelResult.resolvedFields.agent_memory_updated as string | number | boolean | readonly string[],
        resolved_sync_version: kernelResult.resolvedFields.sync_version as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F050TwoWayManualEditSyncTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F050_FEATURE_ID,
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

  public getAuditTrail(): readonly F050TwoWayManualEditSyncAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F050TwoWayManualEditSyncOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF050Module(): {
  featureId: typeof F050_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F050TwoWayManualEditSyncEngine();
  const sampleInput: F050TwoWayManualEditSyncInput = {
    requestId: "req_verify_f050",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f050_artifact_id_seed",
    user_diff_patch: 42,
    agent_memory_updated: true,
    sync_version: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 50 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F050" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F050_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
