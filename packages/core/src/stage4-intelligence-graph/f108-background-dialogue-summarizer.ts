/**
 * F108 (stage4-intelligence-graph): Автоматическая суммаризация старых веток диалога
 * Фоновое сжатие длинных чатов в структурированные конспекты узлов памяти
 * Operation Code: dialogue_compactor
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F108_FEATURE_ID = "F108" as const;
export const F108_STAGE = "stage4-intelligence-graph" as const;
export const F108_OPERATION_CODE = "dialogue_compactor" as const;
export const F108_CONTRACT_VERSION = "2.0.0" as const;

export type F108BackgroundDialogueSummarizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F108BackgroundDialogueSummarizerConfig {
  readonly featureId: typeof F108_FEATURE_ID;
  readonly stage: typeof F108_STAGE;
  readonly operationCode: typeof F108_OPERATION_CODE;
  readonly contractVersion: typeof F108_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F108BackgroundDialogueSummarizerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly thread_id: string;
  readonly original_messages_count: string | number;
  readonly compressed_digest: string | number | boolean | readonly string[];
  readonly compression_ratio: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F108BackgroundDialogueSummarizerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F108_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F108BackgroundDialogueSummarizerOutput {
  readonly featureId: typeof F108_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F108BackgroundDialogueSummarizerExecutionStatus;
  readonly operationCode: typeof F108_OPERATION_CODE;
  readonly resolved_thread_id: string;
  readonly resolved_original_messages_count: string | number;
  readonly resolved_compressed_digest: string | number | boolean | readonly string[];
  readonly resolved_compression_ratio: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F108BackgroundDialogueSummarizerAuditEntry;
}

export interface F108BackgroundDialogueSummarizerTelemetrySnapshot {
  readonly featureId: typeof F108_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F108_CONFIG: F108BackgroundDialogueSummarizerConfig = {
  featureId: F108_FEATURE_ID,
  stage: F108_STAGE,
  operationCode: F108_OPERATION_CODE,
  contractVersion: F108_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F108BackgroundDialogueSummarizerValidationError extends Error {
  public readonly featureId = F108_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F108 Validation Error on '${field}']: ${message}`);
    this.name = "F108BackgroundDialogueSummarizerValidationError";
    this.field = field;
  }
}

export function computeF108Digest(rawPayload: string): string {
  return `f108_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F108BackgroundDialogueSummarizerEngine {
  private readonly config: F108BackgroundDialogueSummarizerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F108BackgroundDialogueSummarizerOutput[] = [];
  private readonly auditLog: F108BackgroundDialogueSummarizerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F108BackgroundDialogueSummarizerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F108BackgroundDialogueSummarizerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F108_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F108BackgroundDialogueSummarizerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F108BackgroundDialogueSummarizerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F108BackgroundDialogueSummarizerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F108BackgroundDialogueSummarizerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F108BackgroundDialogueSummarizerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F108BackgroundDialogueSummarizerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F108BackgroundDialogueSummarizerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F108BackgroundDialogueSummarizerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.thread_id).trim().length === 0) {
      throw new F108BackgroundDialogueSummarizerValidationError("thread_id", "Primary domain attribute 'thread_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      thread_id: input.thread_id,
      original_messages_count: input.original_messages_count,
      compressed_digest: input.compressed_digest,
      compression_ratio: input.compression_ratio
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F108BackgroundDialogueSummarizerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F108BackgroundDialogueSummarizerInput): F108BackgroundDialogueSummarizerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F108_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        thread_id: input.thread_id,
        original_messages_count: input.original_messages_count,
        compressed_digest: input.compressed_digest,
        compression_ratio: input.compression_ratio
      });
      const payloadHash = computeF108Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F108BackgroundDialogueSummarizerValidationError(
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
        featureId: F108_FEATURE_ID,
        operationCode: F108_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          thread_id: input.thread_id,
          original_messages_count: input.original_messages_count,
          compressed_digest: input.compressed_digest,
          compression_ratio: input.compression_ratio
        }
      });

      const executionId = `exec_f108_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f108_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F108BackgroundDialogueSummarizerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F108_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `dialogue_compactor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F108BackgroundDialogueSummarizerOutput = {
        featureId: F108_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F108_OPERATION_CODE,
        resolved_thread_id: kernelResult.resolvedFields.thread_id as string,
        resolved_original_messages_count: kernelResult.resolvedFields.original_messages_count as string | number,
        resolved_compressed_digest: kernelResult.resolvedFields.compressed_digest as string | number | boolean | readonly string[],
        resolved_compression_ratio: kernelResult.resolvedFields.compression_ratio as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F108BackgroundDialogueSummarizerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F108_FEATURE_ID,
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

  public getAuditTrail(): readonly F108BackgroundDialogueSummarizerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F108BackgroundDialogueSummarizerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF108Module(): {
  featureId: typeof F108_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F108BackgroundDialogueSummarizerEngine();
  const sampleInput: F108BackgroundDialogueSummarizerInput = {
    requestId: "req_verify_f108",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    thread_id: "f108_thread_id_seed",
    original_messages_count: 42,
    compressed_digest: true,
    compression_ratio: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 108 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F108" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_thread_id !== sampleInput.thread_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F108_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
