/**
 * F024 (stage1-autonomy): Дедупликация вызовов инструментов
 * Кэширование идентичных запросов агентов в рамках одной сессии
 * Operation Code: tool_dedup_cache
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F024_FEATURE_ID = "F024" as const;
export const F024_STAGE = "stage1-autonomy" as const;
export const F024_OPERATION_CODE = "tool_dedup_cache" as const;
export const F024_CONTRACT_VERSION = "2.0.0" as const;

export type F024ToolCallDeduplicationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F024ToolCallDeduplicationConfig {
  readonly featureId: typeof F024_FEATURE_ID;
  readonly stage: typeof F024_STAGE;
  readonly operationCode: typeof F024_OPERATION_CODE;
  readonly contractVersion: typeof F024_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F024ToolCallDeduplicationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly session_id: string;
  readonly call_fingerprint: string | number;
  readonly cache_hit: string | number | boolean | readonly string[];
  readonly saved_execution_ms: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F024ToolCallDeduplicationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F024_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F024ToolCallDeduplicationOutput {
  readonly featureId: typeof F024_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F024ToolCallDeduplicationExecutionStatus;
  readonly operationCode: typeof F024_OPERATION_CODE;
  readonly resolved_session_id: string;
  readonly resolved_call_fingerprint: string | number;
  readonly resolved_cache_hit: string | number | boolean | readonly string[];
  readonly resolved_saved_execution_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F024ToolCallDeduplicationAuditEntry;
}

export interface F024ToolCallDeduplicationTelemetrySnapshot {
  readonly featureId: typeof F024_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F024_CONFIG: F024ToolCallDeduplicationConfig = {
  featureId: F024_FEATURE_ID,
  stage: F024_STAGE,
  operationCode: F024_OPERATION_CODE,
  contractVersion: F024_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F024ToolCallDeduplicationValidationError extends Error {
  public readonly featureId = F024_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F024 Validation Error on '${field}']: ${message}`);
    this.name = "F024ToolCallDeduplicationValidationError";
    this.field = field;
  }
}

export function computeF024Digest(rawPayload: string): string {
  return `f024_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F024ToolCallDeduplicationEngine {
  private readonly config: F024ToolCallDeduplicationConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F024ToolCallDeduplicationOutput[] = [];
  private readonly auditLog: F024ToolCallDeduplicationAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F024ToolCallDeduplicationOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F024ToolCallDeduplicationConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F024_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F024ToolCallDeduplicationConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F024ToolCallDeduplicationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F024ToolCallDeduplicationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F024ToolCallDeduplicationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F024ToolCallDeduplicationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F024ToolCallDeduplicationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F024ToolCallDeduplicationValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F024ToolCallDeduplicationValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.session_id).trim().length === 0) {
      throw new F024ToolCallDeduplicationValidationError("session_id", "Primary domain attribute 'session_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      session_id: input.session_id,
      call_fingerprint: input.call_fingerprint,
      cache_hit: input.cache_hit,
      saved_execution_ms: input.saved_execution_ms
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F024ToolCallDeduplicationValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F024ToolCallDeduplicationInput): F024ToolCallDeduplicationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F024_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        session_id: input.session_id,
        call_fingerprint: input.call_fingerprint,
        cache_hit: input.cache_hit,
        saved_execution_ms: input.saved_execution_ms
      });
      const payloadHash = computeF024Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F024ToolCallDeduplicationValidationError(
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
        featureId: F024_FEATURE_ID,
        operationCode: F024_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          session_id: input.session_id,
          call_fingerprint: input.call_fingerprint,
          cache_hit: input.cache_hit,
          saved_execution_ms: input.saved_execution_ms
        }
      });

      const executionId = `exec_f024_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f024_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F024ToolCallDeduplicationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F024_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tool_dedup_cache:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F024ToolCallDeduplicationOutput = {
        featureId: F024_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F024_OPERATION_CODE,
        resolved_session_id: kernelResult.resolvedFields.session_id as string,
        resolved_call_fingerprint: kernelResult.resolvedFields.call_fingerprint as string | number,
        resolved_cache_hit: kernelResult.resolvedFields.cache_hit as string | number | boolean | readonly string[],
        resolved_saved_execution_ms: kernelResult.resolvedFields.saved_execution_ms as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F024ToolCallDeduplicationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F024_FEATURE_ID,
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

  public getAuditTrail(): readonly F024ToolCallDeduplicationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F024ToolCallDeduplicationOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF024Module(): {
  featureId: typeof F024_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F024ToolCallDeduplicationEngine();
  const sampleInput: F024ToolCallDeduplicationInput = {
    requestId: "req_verify_f024",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    session_id: "f024_session_id_seed",
    call_fingerprint: 42,
    cache_hit: true,
    saved_execution_ms: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 24 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F024" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_session_id !== sampleInput.session_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F024_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
