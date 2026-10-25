/**
 * F006 (stage1-autonomy): Институт Агента-Критика (Critic Agent)
 * Выделенный проверяющий контур для ревью кода, текста и таблиц до показа пользователю
 * Operation Code: critic_review
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F006_FEATURE_ID = "F006" as const;
export const F006_STAGE = "stage1-autonomy" as const;
export const F006_OPERATION_CODE = "critic_review" as const;
export const F006_CONTRACT_VERSION = "2.0.0" as const;

export type F006CriticAgentInstituteExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F006CriticAgentInstituteConfig {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly stage: typeof F006_STAGE;
  readonly operationCode: typeof F006_OPERATION_CODE;
  readonly contractVersion: typeof F006_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F006CriticAgentInstituteInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly review_id: string;
  readonly target_artifact_id: string | number;
  readonly rubric_scores: string | number | boolean | readonly string[];
  readonly blocking_issues: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F006CriticAgentInstituteAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F006_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F006CriticAgentInstituteOutput {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F006CriticAgentInstituteExecutionStatus;
  readonly operationCode: typeof F006_OPERATION_CODE;
  readonly resolved_review_id: string;
  readonly resolved_target_artifact_id: string | number;
  readonly resolved_rubric_scores: string | number | boolean | readonly string[];
  readonly resolved_blocking_issues: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F006CriticAgentInstituteAuditEntry;
}

export interface F006CriticAgentInstituteTelemetrySnapshot {
  readonly featureId: typeof F006_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F006_CONFIG: F006CriticAgentInstituteConfig = {
  featureId: F006_FEATURE_ID,
  stage: F006_STAGE,
  operationCode: F006_OPERATION_CODE,
  contractVersion: F006_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F006CriticAgentInstituteValidationError extends Error {
  public readonly featureId = F006_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F006 Validation Error on '${field}']: ${message}`);
    this.name = "F006CriticAgentInstituteValidationError";
    this.field = field;
  }
}

export function computeF006Digest(rawPayload: string): string {
  return `f006_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F006CriticAgentInstituteEngine {
  private readonly config: F006CriticAgentInstituteConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F006CriticAgentInstituteOutput[] = [];
  private readonly auditLog: F006CriticAgentInstituteAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F006CriticAgentInstituteOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F006CriticAgentInstituteConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F006_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F006CriticAgentInstituteConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F006CriticAgentInstituteInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F006CriticAgentInstituteValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.review_id).trim().length === 0) {
      throw new F006CriticAgentInstituteValidationError("review_id", "Primary domain attribute 'review_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      review_id: input.review_id,
      target_artifact_id: input.target_artifact_id,
      rubric_scores: input.rubric_scores,
      blocking_issues: input.blocking_issues
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F006CriticAgentInstituteValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F006CriticAgentInstituteInput): F006CriticAgentInstituteOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F006_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        review_id: input.review_id,
        target_artifact_id: input.target_artifact_id,
        rubric_scores: input.rubric_scores,
        blocking_issues: input.blocking_issues
      });
      const payloadHash = computeF006Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F006CriticAgentInstituteValidationError(
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
        featureId: F006_FEATURE_ID,
        operationCode: F006_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          review_id: input.review_id,
          target_artifact_id: input.target_artifact_id,
          rubric_scores: input.rubric_scores,
          blocking_issues: input.blocking_issues
        }
      });

      const executionId = `exec_f006_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f006_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F006CriticAgentInstituteAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F006_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `critic_review:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F006CriticAgentInstituteOutput = {
        featureId: F006_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F006_OPERATION_CODE,
        resolved_review_id: kernelResult.resolvedFields.review_id as string,
        resolved_target_artifact_id: kernelResult.resolvedFields.target_artifact_id as string | number,
        resolved_rubric_scores: kernelResult.resolvedFields.rubric_scores as string | number | boolean | readonly string[],
        resolved_blocking_issues: kernelResult.resolvedFields.blocking_issues as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F006CriticAgentInstituteTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F006_FEATURE_ID,
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

  public getAuditTrail(): readonly F006CriticAgentInstituteAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F006CriticAgentInstituteOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF006Module(): {
  featureId: typeof F006_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F006CriticAgentInstituteEngine();
  const sampleInput: F006CriticAgentInstituteInput = {
    requestId: "req_verify_f006",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    review_id: "f006_review_id_seed",
    target_artifact_id: 42,
    rubric_scores: true,
    blocking_issues: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 6 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F006" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_review_id !== sampleInput.review_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F006_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
