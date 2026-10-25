/**
 * F004 (stage1-autonomy): Граф происхождения артефактов (Artifact Provenance Graph)
 * Отслеживание полной цепочки: кто создал, на основе каких данных и каким промптом
 * Operation Code: provenance_lineage
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F004_FEATURE_ID = "F004" as const;
export const F004_STAGE = "stage1-autonomy" as const;
export const F004_OPERATION_CODE = "provenance_lineage" as const;
export const F004_CONTRACT_VERSION = "2.0.0" as const;

export type F004ArtifactProvenanceGraphExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F004ArtifactProvenanceGraphConfig {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly stage: typeof F004_STAGE;
  readonly operationCode: typeof F004_OPERATION_CODE;
  readonly contractVersion: typeof F004_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F004ArtifactProvenanceGraphInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly prompt_hash: string | number;
  readonly source_artifact_ids: string | number | boolean | readonly string[];
  readonly model_route_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F004ArtifactProvenanceGraphAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F004_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F004ArtifactProvenanceGraphOutput {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F004ArtifactProvenanceGraphExecutionStatus;
  readonly operationCode: typeof F004_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_prompt_hash: string | number;
  readonly resolved_source_artifact_ids: string | number | boolean | readonly string[];
  readonly resolved_model_route_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F004ArtifactProvenanceGraphAuditEntry;
}

export interface F004ArtifactProvenanceGraphTelemetrySnapshot {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F004_CONFIG: F004ArtifactProvenanceGraphConfig = {
  featureId: F004_FEATURE_ID,
  stage: F004_STAGE,
  operationCode: F004_OPERATION_CODE,
  contractVersion: F004_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F004ArtifactProvenanceGraphValidationError extends Error {
  public readonly featureId = F004_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F004 Validation Error on '${field}']: ${message}`);
    this.name = "F004ArtifactProvenanceGraphValidationError";
    this.field = field;
  }
}

export function computeF004Digest(rawPayload: string): string {
  return `f004_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F004ArtifactProvenanceGraphEngine {
  private readonly config: F004ArtifactProvenanceGraphConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F004ArtifactProvenanceGraphOutput[] = [];
  private readonly auditLog: F004ArtifactProvenanceGraphAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F004ArtifactProvenanceGraphOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F004ArtifactProvenanceGraphConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F004_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F004ArtifactProvenanceGraphConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F004ArtifactProvenanceGraphInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F004ArtifactProvenanceGraphValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      prompt_hash: input.prompt_hash,
      source_artifact_ids: input.source_artifact_ids,
      model_route_id: input.model_route_id
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F004ArtifactProvenanceGraphValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F004ArtifactProvenanceGraphInput): F004ArtifactProvenanceGraphOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F004_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        prompt_hash: input.prompt_hash,
        source_artifact_ids: input.source_artifact_ids,
        model_route_id: input.model_route_id
      });
      const payloadHash = computeF004Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F004ArtifactProvenanceGraphValidationError(
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
        featureId: F004_FEATURE_ID,
        operationCode: F004_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          prompt_hash: input.prompt_hash,
          source_artifact_ids: input.source_artifact_ids,
          model_route_id: input.model_route_id
        }
      });

      const executionId = `exec_f004_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f004_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F004ArtifactProvenanceGraphAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F004_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `provenance_lineage:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F004ArtifactProvenanceGraphOutput = {
        featureId: F004_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F004_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_prompt_hash: kernelResult.resolvedFields.prompt_hash as string | number,
        resolved_source_artifact_ids: kernelResult.resolvedFields.source_artifact_ids as string | number | boolean | readonly string[],
        resolved_model_route_id: kernelResult.resolvedFields.model_route_id as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F004ArtifactProvenanceGraphTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F004_FEATURE_ID,
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

  public getAuditTrail(): readonly F004ArtifactProvenanceGraphAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F004ArtifactProvenanceGraphOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF004Module(): {
  featureId: typeof F004_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F004ArtifactProvenanceGraphEngine();
  const sampleInput: F004ArtifactProvenanceGraphInput = {
    requestId: "req_verify_f004",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f004_artifact_id_seed",
    prompt_hash: 42,
    source_artifact_ids: true,
    model_route_id: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 4 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F004" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F004_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
