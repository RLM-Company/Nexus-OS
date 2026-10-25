/**
 * F064 (stage2-canvas): Сшивка нескольких артефактов в мастер-документ
 * Объединение разрозненных заметок, таблиц и графиков в единый финальный релиз
 * Operation Code: master_doc_stitcher
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F064_FEATURE_ID = "F064" as const;
export const F064_STAGE = "stage2-canvas" as const;
export const F064_OPERATION_CODE = "master_doc_stitcher" as const;
export const F064_CONTRACT_VERSION = "2.0.0" as const;

export type F064MasterDocumentStitcherExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F064MasterDocumentStitcherConfig {
  readonly featureId: typeof F064_FEATURE_ID;
  readonly stage: typeof F064_STAGE;
  readonly operationCode: typeof F064_OPERATION_CODE;
  readonly contractVersion: typeof F064_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F064MasterDocumentStitcherInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly master_artifact_id: string;
  readonly source_tab_ids: string | number;
  readonly unified_toc: string | number | boolean | readonly string[];
  readonly compiled_markdown: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F064MasterDocumentStitcherAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F064_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F064MasterDocumentStitcherOutput {
  readonly featureId: typeof F064_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F064MasterDocumentStitcherExecutionStatus;
  readonly operationCode: typeof F064_OPERATION_CODE;
  readonly resolved_master_artifact_id: string;
  readonly resolved_source_tab_ids: string | number;
  readonly resolved_unified_toc: string | number | boolean | readonly string[];
  readonly resolved_compiled_markdown: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F064MasterDocumentStitcherAuditEntry;
}

export interface F064MasterDocumentStitcherTelemetrySnapshot {
  readonly featureId: typeof F064_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F064_CONFIG: F064MasterDocumentStitcherConfig = {
  featureId: F064_FEATURE_ID,
  stage: F064_STAGE,
  operationCode: F064_OPERATION_CODE,
  contractVersion: F064_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F064MasterDocumentStitcherValidationError extends Error {
  public readonly featureId = F064_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F064 Validation Error on '${field}']: ${message}`);
    this.name = "F064MasterDocumentStitcherValidationError";
    this.field = field;
  }
}

export function computeF064Digest(rawPayload: string): string {
  return `f064_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F064MasterDocumentStitcherEngine {
  private readonly config: F064MasterDocumentStitcherConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F064MasterDocumentStitcherOutput[] = [];
  private readonly auditLog: F064MasterDocumentStitcherAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F064MasterDocumentStitcherOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F064MasterDocumentStitcherConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F064_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F064MasterDocumentStitcherConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F064MasterDocumentStitcherInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F064MasterDocumentStitcherValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F064MasterDocumentStitcherValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F064MasterDocumentStitcherValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F064MasterDocumentStitcherValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F064MasterDocumentStitcherValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F064MasterDocumentStitcherValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.master_artifact_id).trim().length === 0) {
      throw new F064MasterDocumentStitcherValidationError("master_artifact_id", "Primary domain attribute 'master_artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      master_artifact_id: input.master_artifact_id,
      source_tab_ids: input.source_tab_ids,
      unified_toc: input.unified_toc,
      compiled_markdown: input.compiled_markdown
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F064MasterDocumentStitcherValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F064MasterDocumentStitcherInput): F064MasterDocumentStitcherOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F064_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        master_artifact_id: input.master_artifact_id,
        source_tab_ids: input.source_tab_ids,
        unified_toc: input.unified_toc,
        compiled_markdown: input.compiled_markdown
      });
      const payloadHash = computeF064Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F064MasterDocumentStitcherValidationError(
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
        featureId: F064_FEATURE_ID,
        operationCode: F064_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          master_artifact_id: input.master_artifact_id,
          source_tab_ids: input.source_tab_ids,
          unified_toc: input.unified_toc,
          compiled_markdown: input.compiled_markdown
        }
      });

      const executionId = `exec_f064_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f064_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F064MasterDocumentStitcherAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F064_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `master_doc_stitcher:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F064MasterDocumentStitcherOutput = {
        featureId: F064_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F064_OPERATION_CODE,
        resolved_master_artifact_id: kernelResult.resolvedFields.master_artifact_id as string,
        resolved_source_tab_ids: kernelResult.resolvedFields.source_tab_ids as string | number,
        resolved_unified_toc: kernelResult.resolvedFields.unified_toc as string | number | boolean | readonly string[],
        resolved_compiled_markdown: kernelResult.resolvedFields.compiled_markdown as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F064MasterDocumentStitcherTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F064_FEATURE_ID,
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

  public getAuditTrail(): readonly F064MasterDocumentStitcherAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F064MasterDocumentStitcherOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF064Module(): {
  featureId: typeof F064_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F064MasterDocumentStitcherEngine();
  const sampleInput: F064MasterDocumentStitcherInput = {
    requestId: "req_verify_f064",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    master_artifact_id: "f064_master_artifact_id_seed",
    source_tab_ids: 42,
    unified_toc: true,
    compiled_markdown: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 64 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F064" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_master_artifact_id !== sampleInput.master_artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F064_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
