/**
 * F033 (stage2-canvas): Двухпанельный интерфейс Kosmora Canvas
 * Синхронная работа чата управления слева и интерактивного рабочего полотна справа
 * Operation Code: dual_pane_sync
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F033_FEATURE_ID = "F033" as const;
export const F033_STAGE = "stage2-canvas" as const;
export const F033_OPERATION_CODE = "dual_pane_sync" as const;
export const F033_CONTRACT_VERSION = "2.0.0" as const;

export type F033DualPaneKosmoraCanvasExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F033DualPaneKosmoraCanvasConfig {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly stage: typeof F033_STAGE;
  readonly operationCode: typeof F033_OPERATION_CODE;
  readonly contractVersion: typeof F033_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F033DualPaneKosmoraCanvasInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly chat_pane_width_pct: string | number;
  readonly canvas_pane_width_pct: string | number | boolean | readonly string[];
  readonly sync_cursor_active: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F033DualPaneKosmoraCanvasAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F033_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F033DualPaneKosmoraCanvasOutput {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F033DualPaneKosmoraCanvasExecutionStatus;
  readonly operationCode: typeof F033_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_chat_pane_width_pct: string | number;
  readonly resolved_canvas_pane_width_pct: string | number | boolean | readonly string[];
  readonly resolved_sync_cursor_active: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F033DualPaneKosmoraCanvasAuditEntry;
}

export interface F033DualPaneKosmoraCanvasTelemetrySnapshot {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F033_CONFIG: F033DualPaneKosmoraCanvasConfig = {
  featureId: F033_FEATURE_ID,
  stage: F033_STAGE,
  operationCode: F033_OPERATION_CODE,
  contractVersion: F033_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F033DualPaneKosmoraCanvasValidationError extends Error {
  public readonly featureId = F033_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F033 Validation Error on '${field}']: ${message}`);
    this.name = "F033DualPaneKosmoraCanvasValidationError";
    this.field = field;
  }
}

export function computeF033Digest(rawPayload: string): string {
  return `f033_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F033DualPaneKosmoraCanvasEngine {
  private readonly config: F033DualPaneKosmoraCanvasConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F033DualPaneKosmoraCanvasOutput[] = [];
  private readonly auditLog: F033DualPaneKosmoraCanvasAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F033DualPaneKosmoraCanvasOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F033DualPaneKosmoraCanvasConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F033_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F033DualPaneKosmoraCanvasConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F033DualPaneKosmoraCanvasInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F033DualPaneKosmoraCanvasValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      workspace_id: input.workspace_id,
      chat_pane_width_pct: input.chat_pane_width_pct,
      canvas_pane_width_pct: input.canvas_pane_width_pct,
      sync_cursor_active: input.sync_cursor_active
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F033DualPaneKosmoraCanvasValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F033DualPaneKosmoraCanvasInput): F033DualPaneKosmoraCanvasOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F033_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        workspace_id: input.workspace_id,
        chat_pane_width_pct: input.chat_pane_width_pct,
        canvas_pane_width_pct: input.canvas_pane_width_pct,
        sync_cursor_active: input.sync_cursor_active
      });
      const payloadHash = computeF033Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F033DualPaneKosmoraCanvasValidationError(
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
        featureId: F033_FEATURE_ID,
        operationCode: F033_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          workspace_id: input.workspace_id,
          chat_pane_width_pct: input.chat_pane_width_pct,
          canvas_pane_width_pct: input.canvas_pane_width_pct,
          sync_cursor_active: input.sync_cursor_active
        }
      });

      const executionId = `exec_f033_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f033_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F033DualPaneKosmoraCanvasAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F033_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `dual_pane_sync:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F033DualPaneKosmoraCanvasOutput = {
        featureId: F033_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F033_OPERATION_CODE,
        resolved_workspace_id: kernelResult.resolvedFields.workspace_id as string,
        resolved_chat_pane_width_pct: kernelResult.resolvedFields.chat_pane_width_pct as string | number,
        resolved_canvas_pane_width_pct: kernelResult.resolvedFields.canvas_pane_width_pct as string | number | boolean | readonly string[],
        resolved_sync_cursor_active: kernelResult.resolvedFields.sync_cursor_active as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F033DualPaneKosmoraCanvasTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F033_FEATURE_ID,
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

  public getAuditTrail(): readonly F033DualPaneKosmoraCanvasAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F033DualPaneKosmoraCanvasOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF033Module(): {
  featureId: typeof F033_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F033DualPaneKosmoraCanvasEngine();
  const sampleInput: F033DualPaneKosmoraCanvasInput = {
    requestId: "req_verify_f033",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f033_workspace_id_seed",
    chat_pane_width_pct: 42,
    canvas_pane_width_pct: true,
    sync_cursor_active: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 33 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F033" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_workspace_id !== sampleInput.workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F033_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
