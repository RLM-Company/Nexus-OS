/**
 * F003 (stage1-autonomy): Связывание рантайм-артефактов с графом задач
 * Жёсткая привязка каждого сгенерированного файла или блока кода к конкретному узлу задачи
 * Operation Code: artifact_binding
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F003_FEATURE_ID = "F003" as const;
export const F003_STAGE = "stage1-autonomy" as const;
export const F003_OPERATION_CODE = "artifact_binding" as const;
export const F003_CONTRACT_VERSION = "2.0.0" as const;

export type F003RuntimeArtifactTaskBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F003RuntimeArtifactTaskBindingConfig {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly stage: typeof F003_STAGE;
  readonly operationCode: typeof F003_OPERATION_CODE;
  readonly contractVersion: typeof F003_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F003RuntimeArtifactTaskBindingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly task_id: string | number;
  readonly graph_id: string | number | boolean | readonly string[];
  readonly producer_role: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F003RuntimeArtifactTaskBindingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F003_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F003RuntimeArtifactTaskBindingOutput {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F003RuntimeArtifactTaskBindingExecutionStatus;
  readonly operationCode: typeof F003_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_task_id: string | number;
  readonly resolved_graph_id: string | number | boolean | readonly string[];
  readonly resolved_producer_role: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F003RuntimeArtifactTaskBindingAuditEntry;
}

export interface F003RuntimeArtifactTaskBindingTelemetrySnapshot {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F003_CONFIG: F003RuntimeArtifactTaskBindingConfig = {
  featureId: F003_FEATURE_ID,
  stage: F003_STAGE,
  operationCode: F003_OPERATION_CODE,
  contractVersion: F003_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F003RuntimeArtifactTaskBindingValidationError extends Error {
  public readonly featureId = F003_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F003 Validation Error on '${field}']: ${message}`);
    this.name = "F003RuntimeArtifactTaskBindingValidationError";
    this.field = field;
  }
}

export function computeF003Digest(rawPayload: string): string {
  return `f003_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F003RuntimeArtifactTaskBindingEngine {
  private readonly config: F003RuntimeArtifactTaskBindingConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F003RuntimeArtifactTaskBindingOutput[] = [];
  private readonly auditLog: F003RuntimeArtifactTaskBindingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F003RuntimeArtifactTaskBindingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F003RuntimeArtifactTaskBindingConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F003_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F003RuntimeArtifactTaskBindingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F003RuntimeArtifactTaskBindingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F003RuntimeArtifactTaskBindingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      artifact_id: input.artifact_id,
      task_id: input.task_id,
      graph_id: input.graph_id,
      producer_role: input.producer_role
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F003RuntimeArtifactTaskBindingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F003RuntimeArtifactTaskBindingInput): F003RuntimeArtifactTaskBindingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F003_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        artifact_id: input.artifact_id,
        task_id: input.task_id,
        graph_id: input.graph_id,
        producer_role: input.producer_role
      });
      const payloadHash = computeF003Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F003RuntimeArtifactTaskBindingValidationError(
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
        featureId: F003_FEATURE_ID,
        operationCode: F003_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          artifact_id: input.artifact_id,
          task_id: input.task_id,
          graph_id: input.graph_id,
          producer_role: input.producer_role
        }
      });

      const executionId = `exec_f003_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f003_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F003RuntimeArtifactTaskBindingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F003_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `artifact_binding:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F003RuntimeArtifactTaskBindingOutput = {
        featureId: F003_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F003_OPERATION_CODE,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string,
        resolved_task_id: kernelResult.resolvedFields.task_id as string | number,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string | number | boolean | readonly string[],
        resolved_producer_role: kernelResult.resolvedFields.producer_role as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F003RuntimeArtifactTaskBindingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F003_FEATURE_ID,
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

  public getAuditTrail(): readonly F003RuntimeArtifactTaskBindingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F003RuntimeArtifactTaskBindingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF003Module(): {
  featureId: typeof F003_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F003RuntimeArtifactTaskBindingEngine();
  const sampleInput: F003RuntimeArtifactTaskBindingInput = {
    requestId: "req_verify_f003",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f003_artifact_id_seed",
    task_id: 42,
    graph_id: true,
    producer_role: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 3 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F003" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F003_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
