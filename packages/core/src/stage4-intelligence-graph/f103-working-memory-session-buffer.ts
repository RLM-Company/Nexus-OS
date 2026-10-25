/**
 * F103 (stage4-intelligence-graph): Краткосрочная память рабочей сессии (Working Memory Buffer)
 * Удержание фокуса на текущих переменных и открытых артефактах без размытия внимания
 * Operation Code: working_memory_ring
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F103_FEATURE_ID = "F103" as const;
export const F103_STAGE = "stage4-intelligence-graph" as const;
export const F103_OPERATION_CODE = "working_memory_ring" as const;
export const F103_CONTRACT_VERSION = "2.0.0" as const;

export type F103WorkingMemorySessionBufferExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F103WorkingMemorySessionBufferConfig {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly stage: typeof F103_STAGE;
  readonly operationCode: typeof F103_OPERATION_CODE;
  readonly contractVersion: typeof F103_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F103WorkingMemorySessionBufferInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly session_id: string;
  readonly active_slots_used: string | number;
  readonly focused_artifact_ids: string | number | boolean | readonly string[];
  readonly attention_score: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F103WorkingMemorySessionBufferAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F103_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F103WorkingMemorySessionBufferOutput {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F103WorkingMemorySessionBufferExecutionStatus;
  readonly operationCode: typeof F103_OPERATION_CODE;
  readonly resolved_session_id: string;
  readonly resolved_active_slots_used: string | number;
  readonly resolved_focused_artifact_ids: string | number | boolean | readonly string[];
  readonly resolved_attention_score: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F103WorkingMemorySessionBufferAuditEntry;
}

export interface F103WorkingMemorySessionBufferTelemetrySnapshot {
  readonly featureId: typeof F103_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F103_CONFIG: F103WorkingMemorySessionBufferConfig = {
  featureId: F103_FEATURE_ID,
  stage: F103_STAGE,
  operationCode: F103_OPERATION_CODE,
  contractVersion: F103_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F103WorkingMemorySessionBufferValidationError extends Error {
  public readonly featureId = F103_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F103 Validation Error on '${field}']: ${message}`);
    this.name = "F103WorkingMemorySessionBufferValidationError";
    this.field = field;
  }
}

export function computeF103Digest(rawPayload: string): string {
  return `f103_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F103WorkingMemorySessionBufferEngine {
  private readonly config: F103WorkingMemorySessionBufferConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F103WorkingMemorySessionBufferOutput[] = [];
  private readonly auditLog: F103WorkingMemorySessionBufferAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F103WorkingMemorySessionBufferOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F103WorkingMemorySessionBufferConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F103_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F103WorkingMemorySessionBufferConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F103WorkingMemorySessionBufferInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F103WorkingMemorySessionBufferValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.session_id).trim().length === 0) {
      throw new F103WorkingMemorySessionBufferValidationError("session_id", "Primary domain attribute 'session_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      session_id: input.session_id,
      active_slots_used: input.active_slots_used,
      focused_artifact_ids: input.focused_artifact_ids,
      attention_score: input.attention_score
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F103WorkingMemorySessionBufferValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F103WorkingMemorySessionBufferInput): F103WorkingMemorySessionBufferOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F103_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        session_id: input.session_id,
        active_slots_used: input.active_slots_used,
        focused_artifact_ids: input.focused_artifact_ids,
        attention_score: input.attention_score
      });
      const payloadHash = computeF103Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F103WorkingMemorySessionBufferValidationError(
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
        featureId: F103_FEATURE_ID,
        operationCode: F103_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          session_id: input.session_id,
          active_slots_used: input.active_slots_used,
          focused_artifact_ids: input.focused_artifact_ids,
          attention_score: input.attention_score
        }
      });

      const executionId = `exec_f103_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f103_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F103WorkingMemorySessionBufferAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F103_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `working_memory_ring:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F103WorkingMemorySessionBufferOutput = {
        featureId: F103_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F103_OPERATION_CODE,
        resolved_session_id: kernelResult.resolvedFields.session_id as string,
        resolved_active_slots_used: kernelResult.resolvedFields.active_slots_used as string | number,
        resolved_focused_artifact_ids: kernelResult.resolvedFields.focused_artifact_ids as string | number | boolean | readonly string[],
        resolved_attention_score: kernelResult.resolvedFields.attention_score as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F103WorkingMemorySessionBufferTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F103_FEATURE_ID,
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

  public getAuditTrail(): readonly F103WorkingMemorySessionBufferAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F103WorkingMemorySessionBufferOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF103Module(): {
  featureId: typeof F103_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F103WorkingMemorySessionBufferEngine();
  const sampleInput: F103WorkingMemorySessionBufferInput = {
    requestId: "req_verify_f103",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    session_id: "f103_session_id_seed",
    active_slots_used: 42,
    focused_artifact_ids: true,
    attention_score: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 103 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F103" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_session_id !== sampleInput.session_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F103_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
