/**
 * F125 (stage4-intelligence-graph): Слияние выводов из параллельных веток чата
 * Перенос финального артефакта из экспериментальной ветки обратно в основную
 * Operation Code: chat_branch_merger
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F125_FEATURE_ID = "F125" as const;
export const F125_STAGE = "stage4-intelligence-graph" as const;
export const F125_OPERATION_CODE = "chat_branch_merger" as const;
export const F125_CONTRACT_VERSION = "2.0.0" as const;

export type F125ParallelChatBranchMergerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F125ParallelChatBranchMergerConfig {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly stage: typeof F125_STAGE;
  readonly operationCode: typeof F125_OPERATION_CODE;
  readonly contractVersion: typeof F125_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F125ParallelChatBranchMergerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_branch_id: string;
  readonly target_branch_id: string | number;
  readonly promoted_artifact_id: string | number | boolean | readonly string[];
  readonly merge_commit_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F125ParallelChatBranchMergerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F125_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F125ParallelChatBranchMergerOutput {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F125ParallelChatBranchMergerExecutionStatus;
  readonly operationCode: typeof F125_OPERATION_CODE;
  readonly resolved_source_branch_id: string;
  readonly resolved_target_branch_id: string | number;
  readonly resolved_promoted_artifact_id: string | number | boolean | readonly string[];
  readonly resolved_merge_commit_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F125ParallelChatBranchMergerAuditEntry;
}

export interface F125ParallelChatBranchMergerTelemetrySnapshot {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F125_CONFIG: F125ParallelChatBranchMergerConfig = {
  featureId: F125_FEATURE_ID,
  stage: F125_STAGE,
  operationCode: F125_OPERATION_CODE,
  contractVersion: F125_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F125ParallelChatBranchMergerValidationError extends Error {
  public readonly featureId = F125_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F125 Validation Error on '${field}']: ${message}`);
    this.name = "F125ParallelChatBranchMergerValidationError";
    this.field = field;
  }
}

export function computeF125Digest(rawPayload: string): string {
  return `f125_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F125ParallelChatBranchMergerEngine {
  private readonly config: F125ParallelChatBranchMergerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F125ParallelChatBranchMergerOutput[] = [];
  private readonly auditLog: F125ParallelChatBranchMergerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F125ParallelChatBranchMergerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F125ParallelChatBranchMergerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F125_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F125ParallelChatBranchMergerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F125ParallelChatBranchMergerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F125ParallelChatBranchMergerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.source_branch_id).trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("source_branch_id", "Primary domain attribute 'source_branch_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      source_branch_id: input.source_branch_id,
      target_branch_id: input.target_branch_id,
      promoted_artifact_id: input.promoted_artifact_id,
      merge_commit_id: input.merge_commit_id
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F125ParallelChatBranchMergerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F125ParallelChatBranchMergerInput): F125ParallelChatBranchMergerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F125_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        source_branch_id: input.source_branch_id,
        target_branch_id: input.target_branch_id,
        promoted_artifact_id: input.promoted_artifact_id,
        merge_commit_id: input.merge_commit_id
      });
      const payloadHash = computeF125Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F125ParallelChatBranchMergerValidationError(
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
        featureId: F125_FEATURE_ID,
        operationCode: F125_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          source_branch_id: input.source_branch_id,
          target_branch_id: input.target_branch_id,
          promoted_artifact_id: input.promoted_artifact_id,
          merge_commit_id: input.merge_commit_id
        }
      });

      const executionId = `exec_f125_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f125_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F125ParallelChatBranchMergerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F125_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `chat_branch_merger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F125ParallelChatBranchMergerOutput = {
        featureId: F125_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F125_OPERATION_CODE,
        resolved_source_branch_id: kernelResult.resolvedFields.source_branch_id as string,
        resolved_target_branch_id: kernelResult.resolvedFields.target_branch_id as string | number,
        resolved_promoted_artifact_id: kernelResult.resolvedFields.promoted_artifact_id as string | number | boolean | readonly string[],
        resolved_merge_commit_id: kernelResult.resolvedFields.merge_commit_id as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F125ParallelChatBranchMergerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F125_FEATURE_ID,
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

  public getAuditTrail(): readonly F125ParallelChatBranchMergerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F125ParallelChatBranchMergerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF125Module(): {
  featureId: typeof F125_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F125ParallelChatBranchMergerEngine();
  const sampleInput: F125ParallelChatBranchMergerInput = {
    requestId: "req_verify_f125",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_branch_id: "f125_source_branch_id_seed",
    target_branch_id: 42,
    promoted_artifact_id: true,
    merge_commit_id: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 125 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F125" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_branch_id !== sampleInput.source_branch_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F125_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
