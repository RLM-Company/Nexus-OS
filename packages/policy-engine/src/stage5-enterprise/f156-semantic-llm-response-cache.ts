/**
 * F156 (stage5-enterprise): Кэширование идентичных LLM-запросов (Semantic Cache)
 * Мгновенный возврат ответа на типовые аналитические подзапросы без повторной оплаты токенов
 * Operation Code: semantic_vector_cache
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F156_FEATURE_ID = "F156" as const;
export const F156_STAGE = "stage5-enterprise" as const;
export const F156_OPERATION_CODE = "semantic_vector_cache" as const;
export const F156_CONTRACT_VERSION = "2.0.0" as const;

export type F156SemanticLlmResponseCacheExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F156SemanticLlmResponseCacheConfig {
  readonly featureId: typeof F156_FEATURE_ID;
  readonly stage: typeof F156_STAGE;
  readonly operationCode: typeof F156_OPERATION_CODE;
  readonly contractVersion: typeof F156_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F156SemanticLlmResponseCacheInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly query_fingerprint: string;
  readonly similarity_hit: string | number;
  readonly tokens_saved: string | number | boolean | readonly string[];
  readonly cached_completion: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F156SemanticLlmResponseCacheAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F156_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F156SemanticLlmResponseCacheOutput {
  readonly featureId: typeof F156_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F156SemanticLlmResponseCacheExecutionStatus;
  readonly operationCode: typeof F156_OPERATION_CODE;
  readonly resolved_query_fingerprint: string;
  readonly resolved_similarity_hit: string | number;
  readonly resolved_tokens_saved: string | number | boolean | readonly string[];
  readonly resolved_cached_completion: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F156SemanticLlmResponseCacheAuditEntry;
}

export interface F156SemanticLlmResponseCacheTelemetrySnapshot {
  readonly featureId: typeof F156_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F156_CONFIG: F156SemanticLlmResponseCacheConfig = {
  featureId: F156_FEATURE_ID,
  stage: F156_STAGE,
  operationCode: F156_OPERATION_CODE,
  contractVersion: F156_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F156SemanticLlmResponseCacheValidationError extends Error {
  public readonly featureId = F156_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F156 Validation Error on '${field}']: ${message}`);
    this.name = "F156SemanticLlmResponseCacheValidationError";
    this.field = field;
  }
}

export function computeF156Digest(rawPayload: string): string {
  return `f156_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F156SemanticLlmResponseCacheEngine {
  private readonly config: F156SemanticLlmResponseCacheConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F156SemanticLlmResponseCacheOutput[] = [];
  private readonly auditLog: F156SemanticLlmResponseCacheAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F156SemanticLlmResponseCacheOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F156SemanticLlmResponseCacheConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F156_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F156SemanticLlmResponseCacheConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F156SemanticLlmResponseCacheInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F156SemanticLlmResponseCacheValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F156SemanticLlmResponseCacheValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F156SemanticLlmResponseCacheValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F156SemanticLlmResponseCacheValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F156SemanticLlmResponseCacheValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F156SemanticLlmResponseCacheValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.query_fingerprint).trim().length === 0) {
      throw new F156SemanticLlmResponseCacheValidationError("query_fingerprint", "Primary domain attribute 'query_fingerprint' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      query_fingerprint: input.query_fingerprint,
      similarity_hit: input.similarity_hit,
      tokens_saved: input.tokens_saved,
      cached_completion: input.cached_completion
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F156SemanticLlmResponseCacheValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F156SemanticLlmResponseCacheInput): F156SemanticLlmResponseCacheOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F156_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        query_fingerprint: input.query_fingerprint,
        similarity_hit: input.similarity_hit,
        tokens_saved: input.tokens_saved,
        cached_completion: input.cached_completion
      });
      const payloadHash = computeF156Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F156SemanticLlmResponseCacheValidationError(
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
        featureId: F156_FEATURE_ID,
        operationCode: F156_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          query_fingerprint: input.query_fingerprint,
          similarity_hit: input.similarity_hit,
          tokens_saved: input.tokens_saved,
          cached_completion: input.cached_completion
        }
      });

      const executionId = `exec_f156_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f156_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F156SemanticLlmResponseCacheAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F156_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `semantic_vector_cache:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F156SemanticLlmResponseCacheOutput = {
        featureId: F156_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F156_OPERATION_CODE,
        resolved_query_fingerprint: kernelResult.resolvedFields.query_fingerprint as string,
        resolved_similarity_hit: kernelResult.resolvedFields.similarity_hit as string | number,
        resolved_tokens_saved: kernelResult.resolvedFields.tokens_saved as string | number | boolean | readonly string[],
        resolved_cached_completion: kernelResult.resolvedFields.cached_completion as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F156SemanticLlmResponseCacheTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F156_FEATURE_ID,
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

  public getAuditTrail(): readonly F156SemanticLlmResponseCacheAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F156SemanticLlmResponseCacheOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF156Module(): {
  featureId: typeof F156_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F156SemanticLlmResponseCacheEngine();
  const sampleInput: F156SemanticLlmResponseCacheInput = {
    requestId: "req_verify_f156",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_fingerprint: "f156_query_fingerprint_seed",
    similarity_hit: 42,
    tokens_saved: true,
    cached_completion: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 156 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F156" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_fingerprint !== sampleInput.query_fingerprint &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F156_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
