/**
 * F045 (stage2-canvas): Множественные вкладки артефактов (Multi-Tab Canvas)
 * Одновременное удержание открытыми кода, презентации и аналитической записки в одной сессии
 * Operation Code: multitab_controller
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F045_FEATURE_ID = "F045" as const;
export const F045_STAGE = "stage2-canvas" as const;
export const F045_OPERATION_CODE = "multitab_controller" as const;
export const F045_CONTRACT_VERSION = "2.0.0" as const;

export type F045MultitabCanvasManagerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F045MultitabCanvasManagerConfig {
  readonly featureId: typeof F045_FEATURE_ID;
  readonly stage: typeof F045_STAGE;
  readonly operationCode: typeof F045_OPERATION_CODE;
  readonly contractVersion: typeof F045_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F045MultitabCanvasManagerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly open_tab_ids: string | number;
  readonly active_tab_id: string | number | boolean | readonly string[];
  readonly pinned_tab_ids: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F045MultitabCanvasManagerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F045_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F045MultitabCanvasManagerOutput {
  readonly featureId: typeof F045_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F045MultitabCanvasManagerExecutionStatus;
  readonly operationCode: typeof F045_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_open_tab_ids: string | number;
  readonly resolved_active_tab_id: string | number | boolean | readonly string[];
  readonly resolved_pinned_tab_ids: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F045MultitabCanvasManagerAuditEntry;
}

export interface F045MultitabCanvasManagerTelemetrySnapshot {
  readonly featureId: typeof F045_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F045_CONFIG: F045MultitabCanvasManagerConfig = {
  featureId: F045_FEATURE_ID,
  stage: F045_STAGE,
  operationCode: F045_OPERATION_CODE,
  contractVersion: F045_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F045MultitabCanvasManagerValidationError extends Error {
  public readonly featureId = F045_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F045 Validation Error on '${field}']: ${message}`);
    this.name = "F045MultitabCanvasManagerValidationError";
    this.field = field;
  }
}

export function computeF045Digest(rawPayload: string): string {
  return `f045_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F045MultitabCanvasManagerEngine {
  private readonly config: F045MultitabCanvasManagerConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F045MultitabCanvasManagerOutput[] = [];
  private readonly auditLog: F045MultitabCanvasManagerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F045MultitabCanvasManagerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F045MultitabCanvasManagerConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F045_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F045MultitabCanvasManagerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F045MultitabCanvasManagerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F045MultitabCanvasManagerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F045MultitabCanvasManagerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F045MultitabCanvasManagerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F045MultitabCanvasManagerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F045MultitabCanvasManagerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F045MultitabCanvasManagerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F045MultitabCanvasManagerValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      open_tab_ids: input.open_tab_ids,
      active_tab_id: input.active_tab_id,
      pinned_tab_ids: input.pinned_tab_ids
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F045MultitabCanvasManagerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F045MultitabCanvasManagerInput): F045MultitabCanvasManagerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F045_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        open_tab_ids: input.open_tab_ids,
        active_tab_id: input.active_tab_id,
        pinned_tab_ids: input.pinned_tab_ids
      });
      const payloadHash = computeF045Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F045MultitabCanvasManagerValidationError(
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
        featureId: F045_FEATURE_ID,
        operationCode: F045_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          open_tab_ids: input.open_tab_ids,
          active_tab_id: input.active_tab_id,
          pinned_tab_ids: input.pinned_tab_ids
        }
      });

      const executionId = `exec_f045_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f045_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F045MultitabCanvasManagerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F045_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `multitab_controller:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F045MultitabCanvasManagerOutput = {
        featureId: F045_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F045_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_open_tab_ids: kernelResult.resolvedFields.open_tab_ids as string | number,
        resolved_active_tab_id: kernelResult.resolvedFields.active_tab_id as string | number | boolean | readonly string[],
        resolved_pinned_tab_ids: kernelResult.resolvedFields.pinned_tab_ids as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F045MultitabCanvasManagerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F045_FEATURE_ID,
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

  public getAuditTrail(): readonly F045MultitabCanvasManagerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F045MultitabCanvasManagerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF045Module(): {
  featureId: typeof F045_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F045MultitabCanvasManagerEngine();
  const sampleInput: F045MultitabCanvasManagerInput = {
    requestId: "req_verify_f045",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f045_workspace_id_seed",
    open_tab_ids: 42,
    active_tab_id: true,
    pinned_tab_ids: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 45 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F045" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F045_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
