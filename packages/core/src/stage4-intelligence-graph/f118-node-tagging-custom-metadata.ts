/**
 * F118 (stage4-intelligence-graph): Тегирование и пользовательские метаданные узлов
 * Ручная и автоматическая разметка документов и артефактов статусами
 * Operation Code: node_metadata_tagger
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F118_FEATURE_ID = "F118" as const;
export const F118_STAGE = "stage4-intelligence-graph" as const;
export const F118_OPERATION_CODE = "node_metadata_tagger" as const;
export const F118_CONTRACT_VERSION = "2.0.0" as const;

export type F118NodeTaggingCustomMetadataExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F118NodeTaggingCustomMetadataConfig {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly stage: typeof F118_STAGE;
  readonly operationCode: typeof F118_OPERATION_CODE;
  readonly contractVersion: typeof F118_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F118NodeTaggingCustomMetadataInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly node_id: string;
  readonly applied_tags: string | number;
  readonly custom_attributes: string | number | boolean | readonly string[];
  readonly indexed_for_filter: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F118NodeTaggingCustomMetadataAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F118_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F118NodeTaggingCustomMetadataOutput {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F118NodeTaggingCustomMetadataExecutionStatus;
  readonly operationCode: typeof F118_OPERATION_CODE;
  readonly resolved_node_id: string;
  readonly resolved_applied_tags: string | number;
  readonly resolved_custom_attributes: string | number | boolean | readonly string[];
  readonly resolved_indexed_for_filter: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F118NodeTaggingCustomMetadataAuditEntry;
}

export interface F118NodeTaggingCustomMetadataTelemetrySnapshot {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F118_CONFIG: F118NodeTaggingCustomMetadataConfig = {
  featureId: F118_FEATURE_ID,
  stage: F118_STAGE,
  operationCode: F118_OPERATION_CODE,
  contractVersion: F118_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F118NodeTaggingCustomMetadataValidationError extends Error {
  public readonly featureId = F118_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F118 Validation Error on '${field}']: ${message}`);
    this.name = "F118NodeTaggingCustomMetadataValidationError";
    this.field = field;
  }
}

export function computeF118Digest(rawPayload: string): string {
  return `f118_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F118NodeTaggingCustomMetadataEngine {
  private readonly config: F118NodeTaggingCustomMetadataConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F118NodeTaggingCustomMetadataOutput[] = [];
  private readonly auditLog: F118NodeTaggingCustomMetadataAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F118NodeTaggingCustomMetadataOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F118NodeTaggingCustomMetadataConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F118_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F118NodeTaggingCustomMetadataConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F118NodeTaggingCustomMetadataInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F118NodeTaggingCustomMetadataValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.node_id).trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("node_id", "Primary domain attribute 'node_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      node_id: input.node_id,
      applied_tags: input.applied_tags,
      custom_attributes: input.custom_attributes,
      indexed_for_filter: input.indexed_for_filter
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F118NodeTaggingCustomMetadataValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F118NodeTaggingCustomMetadataInput): F118NodeTaggingCustomMetadataOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F118_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        node_id: input.node_id,
        applied_tags: input.applied_tags,
        custom_attributes: input.custom_attributes,
        indexed_for_filter: input.indexed_for_filter
      });
      const payloadHash = computeF118Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F118NodeTaggingCustomMetadataValidationError(
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
        featureId: F118_FEATURE_ID,
        operationCode: F118_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          node_id: input.node_id,
          applied_tags: input.applied_tags,
          custom_attributes: input.custom_attributes,
          indexed_for_filter: input.indexed_for_filter
        }
      });

      const executionId = `exec_f118_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f118_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F118NodeTaggingCustomMetadataAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F118_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `node_metadata_tagger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F118NodeTaggingCustomMetadataOutput = {
        featureId: F118_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F118_OPERATION_CODE,
        resolved_node_id: kernelResult.resolvedFields.node_id as string,
        resolved_applied_tags: kernelResult.resolvedFields.applied_tags as string | number,
        resolved_custom_attributes: kernelResult.resolvedFields.custom_attributes as string | number | boolean | readonly string[],
        resolved_indexed_for_filter: kernelResult.resolvedFields.indexed_for_filter as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F118NodeTaggingCustomMetadataTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F118_FEATURE_ID,
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

  public getAuditTrail(): readonly F118NodeTaggingCustomMetadataAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F118NodeTaggingCustomMetadataOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF118Module(): {
  featureId: typeof F118_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F118NodeTaggingCustomMetadataEngine();
  const sampleInput: F118NodeTaggingCustomMetadataInput = {
    requestId: "req_verify_f118",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    node_id: "f118_node_id_seed",
    applied_tags: 42,
    custom_attributes: true,
    indexed_for_filter: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 118 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F118" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_node_id !== sampleInput.node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F118_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
