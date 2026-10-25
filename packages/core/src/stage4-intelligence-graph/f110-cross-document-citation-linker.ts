/**
 * F110 (stage4-intelligence-graph): Кросс-документное связывание цитат
 * Обнаружение общих тем и противоречий между десятками разных PDF и таблиц в воркспейсе
 * Operation Code: cross_doc_correlator
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F110_FEATURE_ID = "F110" as const;
export const F110_STAGE = "stage4-intelligence-graph" as const;
export const F110_OPERATION_CODE = "cross_doc_correlator" as const;
export const F110_CONTRACT_VERSION = "2.0.0" as const;

export type F110CrossDocumentCitationLinkerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F110CrossDocumentCitationLinkerConfig {
  readonly featureId: typeof F110_FEATURE_ID;
  readonly stage: typeof F110_STAGE;
  readonly operationCode: typeof F110_OPERATION_CODE;
  readonly contractVersion: typeof F110_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F110CrossDocumentCitationLinkerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly cluster_id: string;
  readonly corroborating_docs: string | number;
  readonly contradicting_pairs: string | number | boolean | readonly string[];
  readonly consensus_summary: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F110CrossDocumentCitationLinkerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F110_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F110CrossDocumentCitationLinkerOutput {
  readonly featureId: typeof F110_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F110CrossDocumentCitationLinkerExecutionStatus;
  readonly operationCode: typeof F110_OPERATION_CODE;
  readonly resolved_cluster_id: string;
  readonly resolved_corroborating_docs: string | number;
  readonly resolved_contradicting_pairs: string | number | boolean | readonly string[];
  readonly resolved_consensus_summary: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F110CrossDocumentCitationLinkerAuditEntry;
}

export interface F110CrossDocumentCitationLinkerTelemetrySnapshot {
  readonly featureId: typeof F110_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F110_CONFIG: F110CrossDocumentCitationLinkerConfig = {
  featureId: F110_FEATURE_ID,
  stage: F110_STAGE,
  operationCode: F110_OPERATION_CODE,
  contractVersion: F110_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F110CrossDocumentCitationLinkerValidationError extends Error {
  public readonly featureId = F110_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F110 Validation Error on '${field}']: ${message}`);
    this.name = "F110CrossDocumentCitationLinkerValidationError";
    this.field = field;
  }
}

export function computeF110Digest(rawPayload: string): string {
  return `f110_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F110CrossDocumentCitationLinkerEngine {
  private readonly config: F110CrossDocumentCitationLinkerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F110CrossDocumentCitationLinkerOutput[] = [];
  private readonly auditLog: F110CrossDocumentCitationLinkerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F110CrossDocumentCitationLinkerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F110CrossDocumentCitationLinkerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F110_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F110CrossDocumentCitationLinkerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F110CrossDocumentCitationLinkerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F110CrossDocumentCitationLinkerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F110CrossDocumentCitationLinkerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F110CrossDocumentCitationLinkerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F110CrossDocumentCitationLinkerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F110CrossDocumentCitationLinkerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F110CrossDocumentCitationLinkerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.cluster_id).trim().length === 0) {
      throw new F110CrossDocumentCitationLinkerValidationError("cluster_id", "Primary domain attribute 'cluster_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      cluster_id: input.cluster_id,
      corroborating_docs: input.corroborating_docs,
      contradicting_pairs: input.contradicting_pairs,
      consensus_summary: input.consensus_summary
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F110CrossDocumentCitationLinkerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F110CrossDocumentCitationLinkerInput): F110CrossDocumentCitationLinkerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F110_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        cluster_id: input.cluster_id,
        corroborating_docs: input.corroborating_docs,
        contradicting_pairs: input.contradicting_pairs,
        consensus_summary: input.consensus_summary
      });
      const payloadHash = computeF110Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F110CrossDocumentCitationLinkerValidationError(
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
        featureId: F110_FEATURE_ID,
        operationCode: F110_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          cluster_id: input.cluster_id,
          corroborating_docs: input.corroborating_docs,
          contradicting_pairs: input.contradicting_pairs,
          consensus_summary: input.consensus_summary
        }
      });

      const executionId = `exec_f110_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f110_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F110CrossDocumentCitationLinkerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F110_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `cross_doc_correlator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F110CrossDocumentCitationLinkerOutput = {
        featureId: F110_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F110_OPERATION_CODE,
        resolved_cluster_id: kernelResult.resolvedFields.cluster_id as string,
        resolved_corroborating_docs: kernelResult.resolvedFields.corroborating_docs as string | number,
        resolved_contradicting_pairs: kernelResult.resolvedFields.contradicting_pairs as string | number | boolean | readonly string[],
        resolved_consensus_summary: kernelResult.resolvedFields.consensus_summary as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F110CrossDocumentCitationLinkerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F110_FEATURE_ID,
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

  public getAuditTrail(): readonly F110CrossDocumentCitationLinkerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F110CrossDocumentCitationLinkerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF110Module(): {
  featureId: typeof F110_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F110CrossDocumentCitationLinkerEngine();
  const sampleInput: F110CrossDocumentCitationLinkerInput = {
    requestId: "req_verify_f110",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    cluster_id: "f110_cluster_id_seed",
    corroborating_docs: 42,
    contradicting_pairs: true,
    consensus_summary: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 110 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F110" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cluster_id !== sampleInput.cluster_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F110_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
