/**
 * F018 (stage1-autonomy): Оценка уверенности ответа (Confidence Scoring)
 * Расчёт метрики достоверности результата перед передачей Менеджеру
 * Operation Code: confidence_estimator
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F018_FEATURE_ID = "F018" as const;
export const F018_STAGE = "stage1-autonomy" as const;
export const F018_OPERATION_CODE = "confidence_estimator" as const;
export const F018_CONTRACT_VERSION = "2.0.0" as const;

export type F018ResponseConfidenceScoringExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F018ResponseConfidenceScoringConfig {
  readonly featureId: typeof F018_FEATURE_ID;
  readonly stage: typeof F018_STAGE;
  readonly operationCode: typeof F018_OPERATION_CODE;
  readonly contractVersion: typeof F018_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F018ResponseConfidenceScoringInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly task_id: string;
  readonly confidence_score: string | number;
  readonly evidence_density: string | number | boolean | readonly string[];
  readonly meets_threshold: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F018ResponseConfidenceScoringAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F018_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F018ResponseConfidenceScoringOutput {
  readonly featureId: typeof F018_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F018ResponseConfidenceScoringExecutionStatus;
  readonly operationCode: typeof F018_OPERATION_CODE;
  readonly resolved_task_id: string;
  readonly resolved_confidence_score: string | number;
  readonly resolved_evidence_density: string | number | boolean | readonly string[];
  readonly resolved_meets_threshold: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F018ResponseConfidenceScoringAuditEntry;
}

export interface F018ResponseConfidenceScoringTelemetrySnapshot {
  readonly featureId: typeof F018_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F018_CONFIG: F018ResponseConfidenceScoringConfig = {
  featureId: F018_FEATURE_ID,
  stage: F018_STAGE,
  operationCode: F018_OPERATION_CODE,
  contractVersion: F018_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F018ResponseConfidenceScoringValidationError extends Error {
  public readonly featureId = F018_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F018 Validation Error on '${field}']: ${message}`);
    this.name = "F018ResponseConfidenceScoringValidationError";
    this.field = field;
  }
}

export function computeF018Digest(rawPayload: string): string {
  return `f018_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F018ResponseConfidenceScoringEngine {
  private readonly config: F018ResponseConfidenceScoringConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F018ResponseConfidenceScoringOutput[] = [];
  private readonly auditLog: F018ResponseConfidenceScoringAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F018ResponseConfidenceScoringOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F018ResponseConfidenceScoringConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F018_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F018ResponseConfidenceScoringConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F018ResponseConfidenceScoringInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F018ResponseConfidenceScoringValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F018ResponseConfidenceScoringValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F018ResponseConfidenceScoringValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F018ResponseConfidenceScoringValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F018ResponseConfidenceScoringValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F018ResponseConfidenceScoringValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.task_id).trim().length === 0) {
      throw new F018ResponseConfidenceScoringValidationError("task_id", "Primary domain attribute 'task_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      task_id: input.task_id,
      confidence_score: input.confidence_score,
      evidence_density: input.evidence_density,
      meets_threshold: input.meets_threshold
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F018ResponseConfidenceScoringValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F018ResponseConfidenceScoringInput): F018ResponseConfidenceScoringOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F018_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        task_id: input.task_id,
        confidence_score: input.confidence_score,
        evidence_density: input.evidence_density,
        meets_threshold: input.meets_threshold
      });
      const payloadHash = computeF018Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F018ResponseConfidenceScoringValidationError(
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
        featureId: F018_FEATURE_ID,
        operationCode: F018_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          task_id: input.task_id,
          confidence_score: input.confidence_score,
          evidence_density: input.evidence_density,
          meets_threshold: input.meets_threshold
        }
      });

      const executionId = `exec_f018_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f018_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F018ResponseConfidenceScoringAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F018_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `confidence_estimator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F018ResponseConfidenceScoringOutput = {
        featureId: F018_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F018_OPERATION_CODE,
        resolved_task_id: kernelResult.resolvedFields.task_id as string,
        resolved_confidence_score: kernelResult.resolvedFields.confidence_score as string | number,
        resolved_evidence_density: kernelResult.resolvedFields.evidence_density as string | number | boolean | readonly string[],
        resolved_meets_threshold: kernelResult.resolvedFields.meets_threshold as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F018ResponseConfidenceScoringTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F018_FEATURE_ID,
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

  public getAuditTrail(): readonly F018ResponseConfidenceScoringAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F018ResponseConfidenceScoringOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF018Module(): {
  featureId: typeof F018_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F018ResponseConfidenceScoringEngine();
  const sampleInput: F018ResponseConfidenceScoringInput = {
    requestId: "req_verify_f018",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    task_id: "f018_task_id_seed",
    confidence_score: 42,
    evidence_density: true,
    meets_threshold: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 18 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F018" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_task_id !== sampleInput.task_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F018_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
