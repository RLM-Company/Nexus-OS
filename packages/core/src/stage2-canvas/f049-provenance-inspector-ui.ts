/**
 * F049 (stage2-canvas): Инспектор цепочки происхождения (Provenance Inspector UI)
 * Боковая панель, показывающая, из каких чанков документов и задач родился текущий артефакт
 * Operation Code: provenance_drawer
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F049_FEATURE_ID = "F049" as const;
export const F049_STAGE = "stage2-canvas" as const;
export const F049_OPERATION_CODE = "provenance_drawer" as const;
export const F049_CONTRACT_VERSION = "2.0.0" as const;

export type F049ProvenanceInspectorUiExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F049ProvenanceInspectorUiConfig {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly stage: typeof F049_STAGE;
  readonly operationCode: typeof F049_OPERATION_CODE;
  readonly contractVersion: typeof F049_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F049ProvenanceInspectorUiInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly upstream_tasks: string | number;
  readonly source_chunks: string | number | boolean | readonly string[];
  readonly lineage_depth: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F049ProvenanceInspectorUiAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F049_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F049ProvenanceInspectorUiOutput {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F049ProvenanceInspectorUiExecutionStatus;
  readonly operationCode: typeof F049_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_upstream_tasks: string | number;
  readonly resolved_source_chunks: string | number | boolean | readonly string[];
  readonly resolved_lineage_depth: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F049ProvenanceInspectorUiAuditEntry;
}

export interface F049ProvenanceInspectorUiTelemetrySnapshot {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F049_CONFIG: F049ProvenanceInspectorUiConfig = {
  featureId: F049_FEATURE_ID,
  stage: F049_STAGE,
  operationCode: F049_OPERATION_CODE,
  contractVersion: F049_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F049ProvenanceInspectorUiValidationError extends Error {
  public readonly featureId = F049_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F049 Validation Error on '${field}']: ${message}`);
    this.name = "F049ProvenanceInspectorUiValidationError";
    this.field = field;
  }
}

export function computeF049Digest(rawPayload: string): string {
  return `f049_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F049ProvenanceInspectorUiEngine {
  private readonly config: F049ProvenanceInspectorUiConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F049ProvenanceInspectorUiOutput[] = [];
  private readonly auditLog: F049ProvenanceInspectorUiAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F049ProvenanceInspectorUiOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F049ProvenanceInspectorUiConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F049_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F049ProvenanceInspectorUiConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F049ProvenanceInspectorUiInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F049ProvenanceInspectorUiValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      upstream_tasks: input.upstream_tasks,
      source_chunks: input.source_chunks,
      lineage_depth: input.lineage_depth
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F049ProvenanceInspectorUiValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F049ProvenanceInspectorUiInput): F049ProvenanceInspectorUiOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F049_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        upstream_tasks: input.upstream_tasks,
        source_chunks: input.source_chunks,
        lineage_depth: input.lineage_depth
      });
      const payloadHash = computeF049Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F049ProvenanceInspectorUiValidationError(
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
        featureId: F049_FEATURE_ID,
        operationCode: F049_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          upstream_tasks: input.upstream_tasks,
          source_chunks: input.source_chunks,
          lineage_depth: input.lineage_depth
        }
      });

      const executionId = `exec_f049_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f049_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F049ProvenanceInspectorUiAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F049_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `provenance_drawer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F049ProvenanceInspectorUiOutput = {
        featureId: F049_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F049_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_upstream_tasks: kernelResult.resolvedFields.upstream_tasks as string | number,
        resolved_source_chunks: kernelResult.resolvedFields.source_chunks as string | number | boolean | readonly string[],
        resolved_lineage_depth: kernelResult.resolvedFields.lineage_depth as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F049ProvenanceInspectorUiTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F049_FEATURE_ID,
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

  public getAuditTrail(): readonly F049ProvenanceInspectorUiAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F049ProvenanceInspectorUiOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF049Module(): {
  featureId: typeof F049_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F049ProvenanceInspectorUiEngine();
  const sampleInput: F049ProvenanceInspectorUiInput = {
    requestId: "req_verify_f049",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f049_artifact_id_seed",
    upstream_tasks: 42,
    source_chunks: true,
    lineage_depth: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 49 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F049" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F049_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
