/**
 * F025 (stage1-autonomy): Стриминг промежуточных мыслей (Thought Streaming)
 * Трансляция лога рассуждений и шагов графа в UI в реальном времени
 * Operation Code: thought_streamer
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F025_FEATURE_ID = "F025" as const;
export const F025_STAGE = "stage1-autonomy" as const;
export const F025_OPERATION_CODE = "thought_streamer" as const;
export const F025_CONTRACT_VERSION = "2.0.0" as const;

export type F025RealtimeThoughtStreamingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F025RealtimeThoughtStreamingConfig {
  readonly featureId: typeof F025_FEATURE_ID;
  readonly stage: typeof F025_STAGE;
  readonly operationCode: typeof F025_OPERATION_CODE;
  readonly contractVersion: typeof F025_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F025RealtimeThoughtStreamingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly stream_id: string;
  readonly task_id: string | number;
  readonly chunk_sequence: string | number | boolean | readonly string[];
  readonly formatted_thought: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F025RealtimeThoughtStreamingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F025_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F025RealtimeThoughtStreamingOutput {
  readonly featureId: typeof F025_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F025RealtimeThoughtStreamingExecutionStatus;
  readonly operationCode: typeof F025_OPERATION_CODE;
  readonly resolved_stream_id: string;
  readonly resolved_task_id: string | number;
  readonly resolved_chunk_sequence: string | number | boolean | readonly string[];
  readonly resolved_formatted_thought: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F025RealtimeThoughtStreamingAuditEntry;
}

export interface F025RealtimeThoughtStreamingTelemetrySnapshot {
  readonly featureId: typeof F025_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F025_CONFIG: F025RealtimeThoughtStreamingConfig = {
  featureId: F025_FEATURE_ID,
  stage: F025_STAGE,
  operationCode: F025_OPERATION_CODE,
  contractVersion: F025_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F025RealtimeThoughtStreamingValidationError extends Error {
  public readonly featureId = F025_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F025 Validation Error on '${field}']: ${message}`);
    this.name = "F025RealtimeThoughtStreamingValidationError";
    this.field = field;
  }
}

export function computeF025Digest(rawPayload: string): string {
  return `f025_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F025RealtimeThoughtStreamingEngine {
  private readonly config: F025RealtimeThoughtStreamingConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F025RealtimeThoughtStreamingOutput[] = [];
  private readonly auditLog: F025RealtimeThoughtStreamingAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F025RealtimeThoughtStreamingOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F025RealtimeThoughtStreamingConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F025_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F025RealtimeThoughtStreamingConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F025RealtimeThoughtStreamingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F025RealtimeThoughtStreamingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F025RealtimeThoughtStreamingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F025RealtimeThoughtStreamingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F025RealtimeThoughtStreamingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F025RealtimeThoughtStreamingValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F025RealtimeThoughtStreamingValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.stream_id).trim().length === 0) {
      throw new F025RealtimeThoughtStreamingValidationError("stream_id", "Primary domain attribute 'stream_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      stream_id: input.stream_id,
      task_id: input.task_id,
      chunk_sequence: input.chunk_sequence,
      formatted_thought: input.formatted_thought
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F025RealtimeThoughtStreamingValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F025RealtimeThoughtStreamingInput): F025RealtimeThoughtStreamingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F025_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        stream_id: input.stream_id,
        task_id: input.task_id,
        chunk_sequence: input.chunk_sequence,
        formatted_thought: input.formatted_thought
      });
      const payloadHash = computeF025Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F025RealtimeThoughtStreamingValidationError(
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
        featureId: F025_FEATURE_ID,
        operationCode: F025_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          stream_id: input.stream_id,
          task_id: input.task_id,
          chunk_sequence: input.chunk_sequence,
          formatted_thought: input.formatted_thought
        }
      });

      const executionId = `exec_f025_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f025_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F025RealtimeThoughtStreamingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F025_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `thought_streamer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F025RealtimeThoughtStreamingOutput = {
        featureId: F025_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F025_OPERATION_CODE,
        resolved_stream_id: kernelResult.resolvedFields.stream_id as string,
        resolved_task_id: kernelResult.resolvedFields.task_id as string | number,
        resolved_chunk_sequence: kernelResult.resolvedFields.chunk_sequence as string | number | boolean | readonly string[],
        resolved_formatted_thought: kernelResult.resolvedFields.formatted_thought as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F025RealtimeThoughtStreamingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F025_FEATURE_ID,
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

  public getAuditTrail(): readonly F025RealtimeThoughtStreamingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F025RealtimeThoughtStreamingOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF025Module(): {
  featureId: typeof F025_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F025RealtimeThoughtStreamingEngine();
  const sampleInput: F025RealtimeThoughtStreamingInput = {
    requestId: "req_verify_f025",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    stream_id: "f025_stream_id_seed",
    task_id: 42,
    chunk_sequence: true,
    formatted_thought: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 25 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F025" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_stream_id !== sampleInput.stream_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F025_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
