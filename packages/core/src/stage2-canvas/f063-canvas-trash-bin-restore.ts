/**
 * F063 (stage2-canvas): Восстановление удалённых вкладок (Canvas Trash Bin)
 * Корзина артефактов сессии с возможностью мгновенного возврата
 * Operation Code: trash_bin_recovery
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F063_FEATURE_ID = "F063" as const;
export const F063_STAGE = "stage2-canvas" as const;
export const F063_OPERATION_CODE = "trash_bin_recovery" as const;
export const F063_CONTRACT_VERSION = "2.0.0" as const;

export type F063CanvasTrashBinRestoreExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F063CanvasTrashBinRestoreConfig {
  readonly featureId: typeof F063_FEATURE_ID;
  readonly stage: typeof F063_STAGE;
  readonly operationCode: typeof F063_OPERATION_CODE;
  readonly contractVersion: typeof F063_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F063CanvasTrashBinRestoreInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly restored_tab_id: string | number;
  readonly preserved_versions_count: string | number | boolean | readonly string[];
  readonly restore_status: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F063CanvasTrashBinRestoreAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F063_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F063CanvasTrashBinRestoreOutput {
  readonly featureId: typeof F063_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F063CanvasTrashBinRestoreExecutionStatus;
  readonly operationCode: typeof F063_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_restored_tab_id: string | number;
  readonly resolved_preserved_versions_count: string | number | boolean | readonly string[];
  readonly resolved_restore_status: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F063CanvasTrashBinRestoreAuditEntry;
}

export interface F063CanvasTrashBinRestoreTelemetrySnapshot {
  readonly featureId: typeof F063_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F063_CONFIG: F063CanvasTrashBinRestoreConfig = {
  featureId: F063_FEATURE_ID,
  stage: F063_STAGE,
  operationCode: F063_OPERATION_CODE,
  contractVersion: F063_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F063CanvasTrashBinRestoreValidationError extends Error {
  public readonly featureId = F063_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F063 Validation Error on '${field}']: ${message}`);
    this.name = "F063CanvasTrashBinRestoreValidationError";
    this.field = field;
  }
}

export function computeF063Digest(rawPayload: string): string {
  return `f063_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F063CanvasTrashBinRestoreEngine {
  private readonly config: F063CanvasTrashBinRestoreConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F063CanvasTrashBinRestoreOutput[] = [];
  private readonly auditLog: F063CanvasTrashBinRestoreAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F063CanvasTrashBinRestoreOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F063CanvasTrashBinRestoreConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F063_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F063CanvasTrashBinRestoreConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F063CanvasTrashBinRestoreInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F063CanvasTrashBinRestoreValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F063CanvasTrashBinRestoreValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F063CanvasTrashBinRestoreValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F063CanvasTrashBinRestoreValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F063CanvasTrashBinRestoreValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F063CanvasTrashBinRestoreValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F063CanvasTrashBinRestoreValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      restored_tab_id: input.restored_tab_id,
      preserved_versions_count: input.preserved_versions_count,
      restore_status: input.restore_status
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F063CanvasTrashBinRestoreValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F063CanvasTrashBinRestoreInput): F063CanvasTrashBinRestoreOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F063_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        restored_tab_id: input.restored_tab_id,
        preserved_versions_count: input.preserved_versions_count,
        restore_status: input.restore_status
      });
      const payloadHash = computeF063Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F063CanvasTrashBinRestoreValidationError(
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
        featureId: F063_FEATURE_ID,
        operationCode: F063_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          restored_tab_id: input.restored_tab_id,
          preserved_versions_count: input.preserved_versions_count,
          restore_status: input.restore_status
        }
      });

      const executionId = `exec_f063_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f063_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F063CanvasTrashBinRestoreAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F063_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `trash_bin_recovery:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F063CanvasTrashBinRestoreOutput = {
        featureId: F063_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F063_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_restored_tab_id: kernelResult.resolvedFields.restored_tab_id as string | number,
        resolved_preserved_versions_count: kernelResult.resolvedFields.preserved_versions_count as string | number | boolean | readonly string[],
        resolved_restore_status: kernelResult.resolvedFields.restore_status as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F063CanvasTrashBinRestoreTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F063_FEATURE_ID,
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

  public getAuditTrail(): readonly F063CanvasTrashBinRestoreAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F063CanvasTrashBinRestoreOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF063Module(): {
  featureId: typeof F063_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F063CanvasTrashBinRestoreEngine();
  const sampleInput: F063CanvasTrashBinRestoreInput = {
    requestId: "req_verify_f063",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f063_workspace_id_seed",
    restored_tab_id: 42,
    preserved_versions_count: true,
    restore_status: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 63 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F063" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F063_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
