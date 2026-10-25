/**
 * F022 (stage1-autonomy): Разрешение конфликтов слияния результатов
 * Арбитраж Менеджером противоречивых выводов от двух параллельных исследовательских агентов
 * Operation Code: conflict_arbiter
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F022_FEATURE_ID = "F022" as const;
export const F022_STAGE = "stage1-autonomy" as const;
export const F022_OPERATION_CODE = "conflict_arbiter" as const;
export const F022_CONTRACT_VERSION = "2.0.0" as const;

export type F022MergeConflictArbitrationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F022MergeConflictArbitrationConfig {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly stage: typeof F022_STAGE;
  readonly operationCode: typeof F022_OPERATION_CODE;
  readonly contractVersion: typeof F022_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F022MergeConflictArbitrationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly conflict_id: string;
  readonly winning_agent_id: string | number;
  readonly arbitration_score: string | number | boolean | readonly string[];
  readonly resolution_rationale: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F022MergeConflictArbitrationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F022_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F022MergeConflictArbitrationOutput {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F022MergeConflictArbitrationExecutionStatus;
  readonly operationCode: typeof F022_OPERATION_CODE;
  readonly resolved_conflict_id: string;
  readonly resolved_winning_agent_id: string | number;
  readonly resolved_arbitration_score: string | number | boolean | readonly string[];
  readonly resolved_resolution_rationale: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F022MergeConflictArbitrationAuditEntry;
}

export interface F022MergeConflictArbitrationTelemetrySnapshot {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F022_CONFIG: F022MergeConflictArbitrationConfig = {
  featureId: F022_FEATURE_ID,
  stage: F022_STAGE,
  operationCode: F022_OPERATION_CODE,
  contractVersion: F022_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F022MergeConflictArbitrationValidationError extends Error {
  public readonly featureId = F022_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F022 Validation Error on '${field}']: ${message}`);
    this.name = "F022MergeConflictArbitrationValidationError";
    this.field = field;
  }
}

export function computeF022Digest(rawPayload: string): string {
  return `f022_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F022MergeConflictArbitrationEngine {
  private readonly config: F022MergeConflictArbitrationConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F022MergeConflictArbitrationOutput[] = [];
  private readonly auditLog: F022MergeConflictArbitrationAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F022MergeConflictArbitrationOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F022MergeConflictArbitrationConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F022_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F022MergeConflictArbitrationConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F022MergeConflictArbitrationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F022MergeConflictArbitrationValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.conflict_id).trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("conflict_id", "Primary domain attribute 'conflict_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      conflict_id: input.conflict_id,
      winning_agent_id: input.winning_agent_id,
      arbitration_score: input.arbitration_score,
      resolution_rationale: input.resolution_rationale
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F022MergeConflictArbitrationValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F022MergeConflictArbitrationInput): F022MergeConflictArbitrationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F022_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        conflict_id: input.conflict_id,
        winning_agent_id: input.winning_agent_id,
        arbitration_score: input.arbitration_score,
        resolution_rationale: input.resolution_rationale
      });
      const payloadHash = computeF022Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F022MergeConflictArbitrationValidationError(
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
        featureId: F022_FEATURE_ID,
        operationCode: F022_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          conflict_id: input.conflict_id,
          winning_agent_id: input.winning_agent_id,
          arbitration_score: input.arbitration_score,
          resolution_rationale: input.resolution_rationale
        }
      });

      const executionId = `exec_f022_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f022_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F022MergeConflictArbitrationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F022_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `conflict_arbiter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F022MergeConflictArbitrationOutput = {
        featureId: F022_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F022_OPERATION_CODE,
        resolved_conflict_id: kernelResult.resolvedFields.conflict_id as string,
        resolved_winning_agent_id: kernelResult.resolvedFields.winning_agent_id as string | number,
        resolved_arbitration_score: kernelResult.resolvedFields.arbitration_score as string | number | boolean | readonly string[],
        resolved_resolution_rationale: kernelResult.resolvedFields.resolution_rationale as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F022MergeConflictArbitrationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F022_FEATURE_ID,
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

  public getAuditTrail(): readonly F022MergeConflictArbitrationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F022MergeConflictArbitrationOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF022Module(): {
  featureId: typeof F022_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F022MergeConflictArbitrationEngine();
  const sampleInput: F022MergeConflictArbitrationInput = {
    requestId: "req_verify_f022",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    conflict_id: "f022_conflict_id_seed",
    winning_agent_id: 42,
    arbitration_score: true,
    resolution_rationale: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 22 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F022" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_conflict_id !== sampleInput.conflict_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F022_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
