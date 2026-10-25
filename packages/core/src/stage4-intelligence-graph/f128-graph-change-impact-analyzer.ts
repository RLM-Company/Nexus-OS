/**
 * F128 (stage4-intelligence-graph): Анализ влияния изменений (Impact Analysis on Graph)
 * Подсветка всех отчётов и задач, которые затронет изменение конкретного входного документа
 * Operation Code: blast_radius_analyzer
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F128_FEATURE_ID = "F128" as const;
export const F128_STAGE = "stage4-intelligence-graph" as const;
export const F128_OPERATION_CODE = "blast_radius_analyzer" as const;
export const F128_CONTRACT_VERSION = "2.0.0" as const;

export type F128GraphChangeImpactAnalyzerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F128GraphChangeImpactAnalyzerConfig {
  readonly featureId: typeof F128_FEATURE_ID;
  readonly stage: typeof F128_STAGE;
  readonly operationCode: typeof F128_OPERATION_CODE;
  readonly contractVersion: typeof F128_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F128GraphChangeImpactAnalyzerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly modified_node_id: string;
  readonly affected_downstream_ids: string | number;
  readonly max_hop_distance: string | number | boolean | readonly string[];
  readonly risk_level: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F128GraphChangeImpactAnalyzerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F128_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F128GraphChangeImpactAnalyzerOutput {
  readonly featureId: typeof F128_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F128GraphChangeImpactAnalyzerExecutionStatus;
  readonly operationCode: typeof F128_OPERATION_CODE;
  readonly resolved_modified_node_id: string;
  readonly resolved_affected_downstream_ids: string | number;
  readonly resolved_max_hop_distance: string | number | boolean | readonly string[];
  readonly resolved_risk_level: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F128GraphChangeImpactAnalyzerAuditEntry;
}

export interface F128GraphChangeImpactAnalyzerTelemetrySnapshot {
  readonly featureId: typeof F128_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F128_CONFIG: F128GraphChangeImpactAnalyzerConfig = {
  featureId: F128_FEATURE_ID,
  stage: F128_STAGE,
  operationCode: F128_OPERATION_CODE,
  contractVersion: F128_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F128GraphChangeImpactAnalyzerValidationError extends Error {
  public readonly featureId = F128_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F128 Validation Error on '${field}']: ${message}`);
    this.name = "F128GraphChangeImpactAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF128Digest(rawPayload: string): string {
  return `f128_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F128GraphChangeImpactAnalyzerEngine {
  private readonly config: F128GraphChangeImpactAnalyzerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F128GraphChangeImpactAnalyzerOutput[] = [];
  private readonly auditLog: F128GraphChangeImpactAnalyzerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F128GraphChangeImpactAnalyzerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F128GraphChangeImpactAnalyzerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F128_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F128GraphChangeImpactAnalyzerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F128GraphChangeImpactAnalyzerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F128GraphChangeImpactAnalyzerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F128GraphChangeImpactAnalyzerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F128GraphChangeImpactAnalyzerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F128GraphChangeImpactAnalyzerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F128GraphChangeImpactAnalyzerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F128GraphChangeImpactAnalyzerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.modified_node_id).trim().length === 0) {
      throw new F128GraphChangeImpactAnalyzerValidationError("modified_node_id", "Primary domain attribute 'modified_node_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      modified_node_id: input.modified_node_id,
      affected_downstream_ids: input.affected_downstream_ids,
      max_hop_distance: input.max_hop_distance,
      risk_level: input.risk_level
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F128GraphChangeImpactAnalyzerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F128GraphChangeImpactAnalyzerInput): F128GraphChangeImpactAnalyzerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F128_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        modified_node_id: input.modified_node_id,
        affected_downstream_ids: input.affected_downstream_ids,
        max_hop_distance: input.max_hop_distance,
        risk_level: input.risk_level
      });
      const payloadHash = computeF128Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F128GraphChangeImpactAnalyzerValidationError(
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
        featureId: F128_FEATURE_ID,
        operationCode: F128_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          modified_node_id: input.modified_node_id,
          affected_downstream_ids: input.affected_downstream_ids,
          max_hop_distance: input.max_hop_distance,
          risk_level: input.risk_level
        }
      });

      const executionId = `exec_f128_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f128_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F128GraphChangeImpactAnalyzerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F128_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `blast_radius_analyzer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F128GraphChangeImpactAnalyzerOutput = {
        featureId: F128_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F128_OPERATION_CODE,
        resolved_modified_node_id: kernelResult.resolvedFields.modified_node_id as string,
        resolved_affected_downstream_ids: kernelResult.resolvedFields.affected_downstream_ids as string | number,
        resolved_max_hop_distance: kernelResult.resolvedFields.max_hop_distance as string | number | boolean | readonly string[],
        resolved_risk_level: kernelResult.resolvedFields.risk_level as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F128GraphChangeImpactAnalyzerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F128_FEATURE_ID,
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

  public getAuditTrail(): readonly F128GraphChangeImpactAnalyzerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F128GraphChangeImpactAnalyzerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF128Module(): {
  featureId: typeof F128_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F128GraphChangeImpactAnalyzerEngine();
  const sampleInput: F128GraphChangeImpactAnalyzerInput = {
    requestId: "req_verify_f128",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    modified_node_id: "f128_modified_node_id_seed",
    affected_downstream_ids: 42,
    max_hop_distance: true,
    risk_level: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 128 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F128" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_modified_node_id !== sampleInput.modified_node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F128_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
