/**
 * F011 (stage1-autonomy): Снимки состояния выполнения (Checkpointing)
 * Сохранение стейта графа на каждом узле для возобновления с места сбоя
 * Operation Code: state_checkpoint
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F011_FEATURE_ID = "F011" as const;
export const F011_STAGE = "stage1-autonomy" as const;
export const F011_OPERATION_CODE = "state_checkpoint" as const;
export const F011_CONTRACT_VERSION = "2.0.0" as const;

export type F011ExecutionCheckpointingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F011ExecutionCheckpointingConfig {
  readonly featureId: typeof F011_FEATURE_ID;
  readonly stage: typeof F011_STAGE;
  readonly operationCode: typeof F011_OPERATION_CODE;
  readonly contractVersion: typeof F011_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F011ExecutionCheckpointingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly checkpoint_id: string;
  readonly graph_id: string | number;
  readonly step_index: string | number | boolean | readonly string[];
  readonly serialized_state_hash: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F011ExecutionCheckpointingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F011_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F011ExecutionCheckpointingOutput {
  readonly featureId: typeof F011_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F011ExecutionCheckpointingExecutionStatus;
  readonly operationCode: typeof F011_OPERATION_CODE;
  readonly resolved_checkpoint_id: string;
  readonly resolved_graph_id: string | number;
  readonly resolved_step_index: string | number | boolean | readonly string[];
  readonly resolved_serialized_state_hash: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F011ExecutionCheckpointingAuditEntry;
}

export interface F011ExecutionCheckpointingTelemetrySnapshot {
  readonly featureId: typeof F011_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F011_CONFIG: F011ExecutionCheckpointingConfig = {
  featureId: F011_FEATURE_ID,
  stage: F011_STAGE,
  operationCode: F011_OPERATION_CODE,
  contractVersion: F011_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F011ExecutionCheckpointingValidationError extends Error {
  public readonly featureId = F011_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F011 Validation Error on '${field}']: ${message}`);
    this.name = "F011ExecutionCheckpointingValidationError";
    this.field = field;
  }
}

export function computeF011Digest(rawPayload: string): string {
  return `f011_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F011ExecutionCheckpointingEngine {
  private readonly config: F011ExecutionCheckpointingConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F011ExecutionCheckpointingOutput[] = [];
  private readonly auditLog: F011ExecutionCheckpointingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F011ExecutionCheckpointingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F011ExecutionCheckpointingConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F011_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F011ExecutionCheckpointingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F011ExecutionCheckpointingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F011ExecutionCheckpointingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F011ExecutionCheckpointingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F011ExecutionCheckpointingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F011ExecutionCheckpointingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F011ExecutionCheckpointingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F011ExecutionCheckpointingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.checkpoint_id).trim().length === 0) {
      throw new F011ExecutionCheckpointingValidationError("checkpoint_id", "Primary domain attribute 'checkpoint_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      checkpoint_id: input.checkpoint_id,
      graph_id: input.graph_id,
      step_index: input.step_index,
      serialized_state_hash: input.serialized_state_hash
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F011ExecutionCheckpointingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F011ExecutionCheckpointingInput): F011ExecutionCheckpointingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F011_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        checkpoint_id: input.checkpoint_id,
        graph_id: input.graph_id,
        step_index: input.step_index,
        serialized_state_hash: input.serialized_state_hash
      });
      const payloadHash = computeF011Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F011ExecutionCheckpointingValidationError(
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
        featureId: F011_FEATURE_ID,
        operationCode: F011_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          checkpoint_id: input.checkpoint_id,
          graph_id: input.graph_id,
          step_index: input.step_index,
          serialized_state_hash: input.serialized_state_hash
        }
      });

      const executionId = `exec_f011_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f011_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F011ExecutionCheckpointingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F011_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `state_checkpoint:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F011ExecutionCheckpointingOutput = {
        featureId: F011_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F011_OPERATION_CODE,
        resolved_checkpoint_id: kernelResult.resolvedFields.checkpoint_id as string,
        resolved_graph_id: kernelResult.resolvedFields.graph_id as string | number,
        resolved_step_index: kernelResult.resolvedFields.step_index as string | number | boolean | readonly string[],
        resolved_serialized_state_hash: kernelResult.resolvedFields.serialized_state_hash as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F011ExecutionCheckpointingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F011_FEATURE_ID,
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

  public getAuditTrail(): readonly F011ExecutionCheckpointingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F011ExecutionCheckpointingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF011Module(): {
  featureId: typeof F011_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F011ExecutionCheckpointingEngine();
  const sampleInput: F011ExecutionCheckpointingInput = {
    requestId: "req_verify_f011",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    checkpoint_id: "f011_checkpoint_id_seed",
    graph_id: 42,
    step_index: true,
    serialized_state_hash: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 11 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F011" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_checkpoint_id !== sampleInput.checkpoint_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F011_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
