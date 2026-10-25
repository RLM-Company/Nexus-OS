/**
 * F106 (stage4-intelligence-graph): Временная шкала графа знаний (Temporal Graph Tracking)
 * Просмотр того, как менялись знания и факты по проекту во времени с поддержкой дат актуальности
 * Operation Code: bitemporal_fact_ledger
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F106_FEATURE_ID = "F106" as const;
export const F106_STAGE = "stage4-intelligence-graph" as const;
export const F106_OPERATION_CODE = "bitemporal_fact_ledger" as const;
export const F106_CONTRACT_VERSION = "2.0.0" as const;

export type F106TemporalKnowledgeGraphTrackerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F106TemporalKnowledgeGraphTrackerConfig {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly stage: typeof F106_STAGE;
  readonly operationCode: typeof F106_OPERATION_CODE;
  readonly contractVersion: typeof F106_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F106TemporalKnowledgeGraphTrackerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly node_id: string;
  readonly valid_from_iso: string | number;
  readonly valid_to_iso: string | number | boolean | readonly string[];
  readonly point_in_time_snapshot: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F106TemporalKnowledgeGraphTrackerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F106_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F106TemporalKnowledgeGraphTrackerOutput {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F106TemporalKnowledgeGraphTrackerExecutionStatus;
  readonly operationCode: typeof F106_OPERATION_CODE;
  readonly resolved_node_id: string;
  readonly resolved_valid_from_iso: string | number;
  readonly resolved_valid_to_iso: string | number | boolean | readonly string[];
  readonly resolved_point_in_time_snapshot: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F106TemporalKnowledgeGraphTrackerAuditEntry;
}

export interface F106TemporalKnowledgeGraphTrackerTelemetrySnapshot {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F106_CONFIG: F106TemporalKnowledgeGraphTrackerConfig = {
  featureId: F106_FEATURE_ID,
  stage: F106_STAGE,
  operationCode: F106_OPERATION_CODE,
  contractVersion: F106_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F106TemporalKnowledgeGraphTrackerValidationError extends Error {
  public readonly featureId = F106_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F106 Validation Error on '${field}']: ${message}`);
    this.name = "F106TemporalKnowledgeGraphTrackerValidationError";
    this.field = field;
  }
}

export function computeF106Digest(rawPayload: string): string {
  return `f106_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F106TemporalKnowledgeGraphTrackerEngine {
  private readonly config: F106TemporalKnowledgeGraphTrackerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F106TemporalKnowledgeGraphTrackerOutput[] = [];
  private readonly auditLog: F106TemporalKnowledgeGraphTrackerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F106TemporalKnowledgeGraphTrackerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F106TemporalKnowledgeGraphTrackerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F106_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F106TemporalKnowledgeGraphTrackerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F106TemporalKnowledgeGraphTrackerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.node_id).trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("node_id", "Primary domain attribute 'node_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      node_id: input.node_id,
      valid_from_iso: input.valid_from_iso,
      valid_to_iso: input.valid_to_iso,
      point_in_time_snapshot: input.point_in_time_snapshot
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F106TemporalKnowledgeGraphTrackerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F106TemporalKnowledgeGraphTrackerInput): F106TemporalKnowledgeGraphTrackerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F106_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        node_id: input.node_id,
        valid_from_iso: input.valid_from_iso,
        valid_to_iso: input.valid_to_iso,
        point_in_time_snapshot: input.point_in_time_snapshot
      });
      const payloadHash = computeF106Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F106TemporalKnowledgeGraphTrackerValidationError(
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
        featureId: F106_FEATURE_ID,
        operationCode: F106_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          node_id: input.node_id,
          valid_from_iso: input.valid_from_iso,
          valid_to_iso: input.valid_to_iso,
          point_in_time_snapshot: input.point_in_time_snapshot
        }
      });

      const executionId = `exec_f106_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f106_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F106TemporalKnowledgeGraphTrackerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F106_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `bitemporal_fact_ledger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F106TemporalKnowledgeGraphTrackerOutput = {
        featureId: F106_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F106_OPERATION_CODE,
        resolved_node_id: kernelResult.resolvedFields.node_id as string,
        resolved_valid_from_iso: kernelResult.resolvedFields.valid_from_iso as string | number,
        resolved_valid_to_iso: kernelResult.resolvedFields.valid_to_iso as string | number | boolean | readonly string[],
        resolved_point_in_time_snapshot: kernelResult.resolvedFields.point_in_time_snapshot as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F106TemporalKnowledgeGraphTrackerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F106_FEATURE_ID,
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

  public getAuditTrail(): readonly F106TemporalKnowledgeGraphTrackerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F106TemporalKnowledgeGraphTrackerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF106Module(): {
  featureId: typeof F106_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F106TemporalKnowledgeGraphTrackerEngine();
  const sampleInput: F106TemporalKnowledgeGraphTrackerInput = {
    requestId: "req_verify_f106",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    node_id: "f106_node_id_seed",
    valid_from_iso: 42,
    valid_to_iso: true,
    point_in_time_snapshot: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 106 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F106" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_node_id !== sampleInput.node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F106_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
