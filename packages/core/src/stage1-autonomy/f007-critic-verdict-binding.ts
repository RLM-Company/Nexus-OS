/**
 * F007 (stage1-autonomy): Привязка вердиктов Критика к артефактам (Critic Verdict Binding)
 * Сохранение статуса (Approved / Needs Revision + комментарии) прямо в метаданных артефакта
 * Operation Code: verdict_binding
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F007_FEATURE_ID = "F007" as const;
export const F007_STAGE = "stage1-autonomy" as const;
export const F007_OPERATION_CODE = "verdict_binding" as const;
export const F007_CONTRACT_VERSION = "2.0.0" as const;

export type F007CriticVerdictBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F007CriticVerdictBindingConfig {
  readonly featureId: typeof F007_FEATURE_ID;
  readonly stage: typeof F007_STAGE;
  readonly operationCode: typeof F007_OPERATION_CODE;
  readonly contractVersion: typeof F007_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F007CriticVerdictBindingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly verdict_id: string;
  readonly artifact_id: string | number;
  readonly verdict_status: string | number | boolean | readonly string[];
  readonly reviewer_comments: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F007CriticVerdictBindingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F007_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F007CriticVerdictBindingOutput {
  readonly featureId: typeof F007_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F007CriticVerdictBindingExecutionStatus;
  readonly operationCode: typeof F007_OPERATION_CODE;
  readonly resolved_verdict_id: string;
  readonly resolved_artifact_id: string | number;
  readonly resolved_verdict_status: string | number | boolean | readonly string[];
  readonly resolved_reviewer_comments: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F007CriticVerdictBindingAuditEntry;
}

export interface F007CriticVerdictBindingTelemetrySnapshot {
  readonly featureId: typeof F007_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F007_CONFIG: F007CriticVerdictBindingConfig = {
  featureId: F007_FEATURE_ID,
  stage: F007_STAGE,
  operationCode: F007_OPERATION_CODE,
  contractVersion: F007_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F007CriticVerdictBindingValidationError extends Error {
  public readonly featureId = F007_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F007 Validation Error on '${field}']: ${message}`);
    this.name = "F007CriticVerdictBindingValidationError";
    this.field = field;
  }
}

export function computeF007Digest(rawPayload: string): string {
  return `f007_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F007CriticVerdictBindingEngine {
  private readonly config: F007CriticVerdictBindingConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F007CriticVerdictBindingOutput[] = [];
  private readonly auditLog: F007CriticVerdictBindingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F007CriticVerdictBindingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F007CriticVerdictBindingConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F007_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F007CriticVerdictBindingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F007CriticVerdictBindingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F007CriticVerdictBindingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F007CriticVerdictBindingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F007CriticVerdictBindingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F007CriticVerdictBindingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F007CriticVerdictBindingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F007CriticVerdictBindingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.verdict_id).trim().length === 0) {
      throw new F007CriticVerdictBindingValidationError("verdict_id", "Primary domain attribute 'verdict_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      verdict_id: input.verdict_id,
      artifact_id: input.artifact_id,
      verdict_status: input.verdict_status,
      reviewer_comments: input.reviewer_comments
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F007CriticVerdictBindingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F007CriticVerdictBindingInput): F007CriticVerdictBindingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F007_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        verdict_id: input.verdict_id,
        artifact_id: input.artifact_id,
        verdict_status: input.verdict_status,
        reviewer_comments: input.reviewer_comments
      });
      const payloadHash = computeF007Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F007CriticVerdictBindingValidationError(
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
        featureId: F007_FEATURE_ID,
        operationCode: F007_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          verdict_id: input.verdict_id,
          artifact_id: input.artifact_id,
          verdict_status: input.verdict_status,
          reviewer_comments: input.reviewer_comments
        }
      });

      const executionId = `exec_f007_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f007_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F007CriticVerdictBindingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F007_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `verdict_binding:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F007CriticVerdictBindingOutput = {
        featureId: F007_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F007_OPERATION_CODE,
        resolved_verdict_id: kernelResult.resolvedFields.verdict_id as string,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string | number,
        resolved_verdict_status: kernelResult.resolvedFields.verdict_status as string | number | boolean | readonly string[],
        resolved_reviewer_comments: kernelResult.resolvedFields.reviewer_comments as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F007CriticVerdictBindingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F007_FEATURE_ID,
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

  public getAuditTrail(): readonly F007CriticVerdictBindingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F007CriticVerdictBindingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF007Module(): {
  featureId: typeof F007_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F007CriticVerdictBindingEngine();
  const sampleInput: F007CriticVerdictBindingInput = {
    requestId: "req_verify_f007",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    verdict_id: "f007_verdict_id_seed",
    artifact_id: 42,
    verdict_status: true,
    reviewer_comments: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 7 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F007" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_verdict_id !== sampleInput.verdict_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F007_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
