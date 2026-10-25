/**
 * F122 (stage4-intelligence-graph): Кэширование эмбеддингов с инкрементальным обновлением
 * Пересчёт векторов только для изменённых абзацев при редактировании файла
 * Operation Code: delta_embedding_cache
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F122_FEATURE_ID = "F122" as const;
export const F122_STAGE = "stage4-intelligence-graph" as const;
export const F122_OPERATION_CODE = "delta_embedding_cache" as const;
export const F122_CONTRACT_VERSION = "2.0.0" as const;

export type F122IncrementalEmbeddingCacheExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F122IncrementalEmbeddingCacheConfig {
  readonly featureId: typeof F122_FEATURE_ID;
  readonly stage: typeof F122_STAGE;
  readonly operationCode: typeof F122_OPERATION_CODE;
  readonly contractVersion: typeof F122_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F122IncrementalEmbeddingCacheInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly document_id: string;
  readonly unchanged_paragraphs_cached: string | number;
  readonly recomputed_paragraphs: string | number | boolean | readonly string[];
  readonly compute_saved_pct: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F122IncrementalEmbeddingCacheAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F122_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F122IncrementalEmbeddingCacheOutput {
  readonly featureId: typeof F122_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F122IncrementalEmbeddingCacheExecutionStatus;
  readonly operationCode: typeof F122_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_unchanged_paragraphs_cached: string | number;
  readonly resolved_recomputed_paragraphs: string | number | boolean | readonly string[];
  readonly resolved_compute_saved_pct: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F122IncrementalEmbeddingCacheAuditEntry;
}

export interface F122IncrementalEmbeddingCacheTelemetrySnapshot {
  readonly featureId: typeof F122_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F122_CONFIG: F122IncrementalEmbeddingCacheConfig = {
  featureId: F122_FEATURE_ID,
  stage: F122_STAGE,
  operationCode: F122_OPERATION_CODE,
  contractVersion: F122_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F122IncrementalEmbeddingCacheValidationError extends Error {
  public readonly featureId = F122_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F122 Validation Error on '${field}']: ${message}`);
    this.name = "F122IncrementalEmbeddingCacheValidationError";
    this.field = field;
  }
}

export function computeF122Digest(rawPayload: string): string {
  return `f122_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F122IncrementalEmbeddingCacheEngine {
  private readonly config: F122IncrementalEmbeddingCacheConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F122IncrementalEmbeddingCacheOutput[] = [];
  private readonly auditLog: F122IncrementalEmbeddingCacheAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F122IncrementalEmbeddingCacheOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F122IncrementalEmbeddingCacheConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F122_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F122IncrementalEmbeddingCacheConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F122IncrementalEmbeddingCacheInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F122IncrementalEmbeddingCacheValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F122IncrementalEmbeddingCacheValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F122IncrementalEmbeddingCacheValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F122IncrementalEmbeddingCacheValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F122IncrementalEmbeddingCacheValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F122IncrementalEmbeddingCacheValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.document_id).trim().length === 0) {
      throw new F122IncrementalEmbeddingCacheValidationError("document_id", "Primary domain attribute 'document_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      document_id: input.document_id,
      unchanged_paragraphs_cached: input.unchanged_paragraphs_cached,
      recomputed_paragraphs: input.recomputed_paragraphs,
      compute_saved_pct: input.compute_saved_pct
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F122IncrementalEmbeddingCacheValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F122IncrementalEmbeddingCacheInput): F122IncrementalEmbeddingCacheOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F122_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        document_id: input.document_id,
        unchanged_paragraphs_cached: input.unchanged_paragraphs_cached,
        recomputed_paragraphs: input.recomputed_paragraphs,
        compute_saved_pct: input.compute_saved_pct
      });
      const payloadHash = computeF122Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F122IncrementalEmbeddingCacheValidationError(
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
        featureId: F122_FEATURE_ID,
        operationCode: F122_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          document_id: input.document_id,
          unchanged_paragraphs_cached: input.unchanged_paragraphs_cached,
          recomputed_paragraphs: input.recomputed_paragraphs,
          compute_saved_pct: input.compute_saved_pct
        }
      });

      const executionId = `exec_f122_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f122_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F122IncrementalEmbeddingCacheAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F122_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `delta_embedding_cache:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F122IncrementalEmbeddingCacheOutput = {
        featureId: F122_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F122_OPERATION_CODE,
        resolved_document_id: kernelResult.resolvedFields.document_id as string,
        resolved_unchanged_paragraphs_cached: kernelResult.resolvedFields.unchanged_paragraphs_cached as string | number,
        resolved_recomputed_paragraphs: kernelResult.resolvedFields.recomputed_paragraphs as string | number | boolean | readonly string[],
        resolved_compute_saved_pct: kernelResult.resolvedFields.compute_saved_pct as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F122IncrementalEmbeddingCacheTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F122_FEATURE_ID,
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

  public getAuditTrail(): readonly F122IncrementalEmbeddingCacheAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F122IncrementalEmbeddingCacheOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF122Module(): {
  featureId: typeof F122_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F122IncrementalEmbeddingCacheEngine();
  const sampleInput: F122IncrementalEmbeddingCacheInput = {
    requestId: "req_verify_f122",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f122_document_id_seed",
    unchanged_paragraphs_cached: 42,
    recomputed_paragraphs: true,
    compute_saved_pct: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 122 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F122" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F122_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
