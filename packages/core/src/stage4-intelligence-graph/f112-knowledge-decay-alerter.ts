/**
 * F112 (stage4-intelligence-graph): Оценка устаревания данных (Knowledge Decay Alert)
 * Маркировка узлов и отчётов, чьи исходные файлы были обновлены, как требующих пересборки
 * Operation Code: staleness_detector
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F112_FEATURE_ID = "F112" as const;
export const F112_STAGE = "stage4-intelligence-graph" as const;
export const F112_OPERATION_CODE = "staleness_detector" as const;
export const F112_CONTRACT_VERSION = "2.0.0" as const;

export type F112KnowledgeDecayAlerterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F112KnowledgeDecayAlerterConfig {
  readonly featureId: typeof F112_FEATURE_ID;
  readonly stage: typeof F112_STAGE;
  readonly operationCode: typeof F112_OPERATION_CODE;
  readonly contractVersion: typeof F112_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F112KnowledgeDecayAlerterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly updated_source_id: string;
  readonly stale_artifact_ids: string | number;
  readonly decay_severity: string | number | boolean | readonly string[];
  readonly rebuild_queued: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F112KnowledgeDecayAlerterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F112_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F112KnowledgeDecayAlerterOutput {
  readonly featureId: typeof F112_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F112KnowledgeDecayAlerterExecutionStatus;
  readonly operationCode: typeof F112_OPERATION_CODE;
  readonly resolved_updated_source_id: string;
  readonly resolved_stale_artifact_ids: string | number;
  readonly resolved_decay_severity: string | number | boolean | readonly string[];
  readonly resolved_rebuild_queued: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F112KnowledgeDecayAlerterAuditEntry;
}

export interface F112KnowledgeDecayAlerterTelemetrySnapshot {
  readonly featureId: typeof F112_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F112_CONFIG: F112KnowledgeDecayAlerterConfig = {
  featureId: F112_FEATURE_ID,
  stage: F112_STAGE,
  operationCode: F112_OPERATION_CODE,
  contractVersion: F112_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F112KnowledgeDecayAlerterValidationError extends Error {
  public readonly featureId = F112_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F112 Validation Error on '${field}']: ${message}`);
    this.name = "F112KnowledgeDecayAlerterValidationError";
    this.field = field;
  }
}

export function computeF112Digest(rawPayload: string): string {
  return `f112_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F112KnowledgeDecayAlerterEngine {
  private readonly config: F112KnowledgeDecayAlerterConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F112KnowledgeDecayAlerterOutput[] = [];
  private readonly auditLog: F112KnowledgeDecayAlerterAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F112KnowledgeDecayAlerterOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F112KnowledgeDecayAlerterConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F112_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F112KnowledgeDecayAlerterConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F112KnowledgeDecayAlerterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F112KnowledgeDecayAlerterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F112KnowledgeDecayAlerterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F112KnowledgeDecayAlerterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F112KnowledgeDecayAlerterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F112KnowledgeDecayAlerterValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F112KnowledgeDecayAlerterValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.updated_source_id).trim().length === 0) {
      throw new F112KnowledgeDecayAlerterValidationError("updated_source_id", "Primary domain attribute 'updated_source_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      updated_source_id: input.updated_source_id,
      stale_artifact_ids: input.stale_artifact_ids,
      decay_severity: input.decay_severity,
      rebuild_queued: input.rebuild_queued
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F112KnowledgeDecayAlerterValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F112KnowledgeDecayAlerterInput): F112KnowledgeDecayAlerterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F112_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        updated_source_id: input.updated_source_id,
        stale_artifact_ids: input.stale_artifact_ids,
        decay_severity: input.decay_severity,
        rebuild_queued: input.rebuild_queued
      });
      const payloadHash = computeF112Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F112KnowledgeDecayAlerterValidationError(
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
        featureId: F112_FEATURE_ID,
        operationCode: F112_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          updated_source_id: input.updated_source_id,
          stale_artifact_ids: input.stale_artifact_ids,
          decay_severity: input.decay_severity,
          rebuild_queued: input.rebuild_queued
        }
      });

      const executionId = `exec_f112_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f112_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F112KnowledgeDecayAlerterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F112_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `staleness_detector:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F112KnowledgeDecayAlerterOutput = {
        featureId: F112_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F112_OPERATION_CODE,
        resolved_updated_source_id: kernelResult.resolvedFields.updated_source_id as string,
        resolved_stale_artifact_ids: kernelResult.resolvedFields.stale_artifact_ids as string | number,
        resolved_decay_severity: kernelResult.resolvedFields.decay_severity as string | number | boolean | readonly string[],
        resolved_rebuild_queued: kernelResult.resolvedFields.rebuild_queued as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F112KnowledgeDecayAlerterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F112_FEATURE_ID,
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

  public getAuditTrail(): readonly F112KnowledgeDecayAlerterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F112KnowledgeDecayAlerterOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF112Module(): {
  featureId: typeof F112_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F112KnowledgeDecayAlerterEngine();
  const sampleInput: F112KnowledgeDecayAlerterInput = {
    requestId: "req_verify_f112",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    updated_source_id: "f112_updated_source_id_seed",
    stale_artifact_ids: 42,
    decay_severity: true,
    rebuild_queued: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 112 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F112" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_updated_source_id !== sampleInput.updated_source_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F112_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
