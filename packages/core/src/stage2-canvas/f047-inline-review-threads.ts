/**
 * F047 (stage2-canvas): Инлайн-комментарии и ревью-треды
 * Закрепление замечаний пользователя или Агента-Критика за конкретной строкой артефакта
 * Operation Code: inline_comment_thread
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F047_FEATURE_ID = "F047" as const;
export const F047_STAGE = "stage2-canvas" as const;
export const F047_OPERATION_CODE = "inline_comment_thread" as const;
export const F047_CONTRACT_VERSION = "2.0.0" as const;

export type F047InlineReviewThreadsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F047InlineReviewThreadsConfig {
  readonly featureId: typeof F047_FEATURE_ID;
  readonly stage: typeof F047_STAGE;
  readonly operationCode: typeof F047_OPERATION_CODE;
  readonly contractVersion: typeof F047_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F047InlineReviewThreadsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly thread_id: string;
  readonly line_number: string | number;
  readonly author_role: string | number | boolean | readonly string[];
  readonly resolved_state: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F047InlineReviewThreadsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F047_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F047InlineReviewThreadsOutput {
  readonly featureId: typeof F047_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F047InlineReviewThreadsExecutionStatus;
  readonly operationCode: typeof F047_OPERATION_CODE;
  readonly resolved_thread_id: string;
  readonly resolved_line_number: string | number;
  readonly resolved_author_role: string | number | boolean | readonly string[];
  readonly resolved_resolved_state: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F047InlineReviewThreadsAuditEntry;
}

export interface F047InlineReviewThreadsTelemetrySnapshot {
  readonly featureId: typeof F047_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F047_CONFIG: F047InlineReviewThreadsConfig = {
  featureId: F047_FEATURE_ID,
  stage: F047_STAGE,
  operationCode: F047_OPERATION_CODE,
  contractVersion: F047_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F047InlineReviewThreadsValidationError extends Error {
  public readonly featureId = F047_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F047 Validation Error on '${field}']: ${message}`);
    this.name = "F047InlineReviewThreadsValidationError";
    this.field = field;
  }
}

export function computeF047Digest(rawPayload: string): string {
  return `f047_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F047InlineReviewThreadsEngine {
  private readonly config: F047InlineReviewThreadsConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F047InlineReviewThreadsOutput[] = [];
  private readonly auditLog: F047InlineReviewThreadsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F047InlineReviewThreadsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F047InlineReviewThreadsConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F047_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F047InlineReviewThreadsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F047InlineReviewThreadsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F047InlineReviewThreadsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F047InlineReviewThreadsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F047InlineReviewThreadsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F047InlineReviewThreadsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F047InlineReviewThreadsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F047InlineReviewThreadsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.thread_id).trim().length === 0) {
      throw new F047InlineReviewThreadsValidationError("thread_id", "Primary domain attribute 'thread_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      thread_id: input.thread_id,
      line_number: input.line_number,
      author_role: input.author_role,
      resolved_state: input.resolved_state
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F047InlineReviewThreadsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F047InlineReviewThreadsInput): F047InlineReviewThreadsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F047_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        thread_id: input.thread_id,
        line_number: input.line_number,
        author_role: input.author_role,
        resolved_state: input.resolved_state
      });
      const payloadHash = computeF047Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F047InlineReviewThreadsValidationError(
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
        featureId: F047_FEATURE_ID,
        operationCode: F047_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          thread_id: input.thread_id,
          line_number: input.line_number,
          author_role: input.author_role,
          resolved_state: input.resolved_state
        }
      });

      const executionId = `exec_f047_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f047_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F047InlineReviewThreadsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F047_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `inline_comment_thread:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F047InlineReviewThreadsOutput = {
        featureId: F047_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F047_OPERATION_CODE,
        resolved_thread_id: kernelResult.resolvedFields.thread_id as string,
        resolved_line_number: kernelResult.resolvedFields.line_number as string | number,
        resolved_author_role: kernelResult.resolvedFields.author_role as string | number | boolean | readonly string[],
        resolved_resolved_state: kernelResult.resolvedFields.resolved_state as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F047InlineReviewThreadsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F047_FEATURE_ID,
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

  public getAuditTrail(): readonly F047InlineReviewThreadsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F047InlineReviewThreadsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF047Module(): {
  featureId: typeof F047_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F047InlineReviewThreadsEngine();
  const sampleInput: F047InlineReviewThreadsInput = {
    requestId: "req_verify_f047",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    thread_id: "f047_thread_id_seed",
    line_number: 42,
    author_role: true,
    resolved_state: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 47 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F047" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_thread_id !== sampleInput.thread_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F047_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
