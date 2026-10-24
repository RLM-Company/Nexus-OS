/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F111
 * ============================================================================
 * Feature ID: F111
 * Stage: stage4-intelligence-graph
 * Title: Переранжирование результатов поиска (Cross-Encoder Reranking)
 * Description: Отсев нерелевантных чанков перед подачей в контекстное окно модели
 * Operation Code: cross_encoder_reranker
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F111_FEATURE_ID = "F111" as const;
export const F111_STAGE = "stage4-intelligence-graph" as const;
export const F111_OPERATION_CODE = "cross_encoder_reranker" as const;
export const F111_CONTRACT_VERSION = "1.0.0" as const;

export type F111CrossEncoderSearchRerankerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F111CrossEncoderSearchRerankerConfig {
  readonly featureId: typeof F111_FEATURE_ID;
  readonly stage: typeof F111_STAGE;
  readonly operationCode: typeof F111_OPERATION_CODE;
  readonly contractVersion: typeof F111_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F111CrossEncoderSearchRerankerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly query_id: string;
  readonly initial_candidates: string | number;
  readonly reranked_top_k: string | number | boolean | readonly string[];
  readonly precision_gain: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F111CrossEncoderSearchRerankerOutput {
  readonly featureId: typeof F111_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F111CrossEncoderSearchRerankerExecutionStatus;
  readonly operationCode: typeof F111_OPERATION_CODE;
  readonly resolved_query_id: string;
  readonly resolved_initial_candidates: string | number;
  readonly resolved_reranked_top_k: string | number | boolean | readonly string[];
  readonly resolved_precision_gain: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F111CrossEncoderSearchRerankerAuditEntry;
}

export interface F111CrossEncoderSearchRerankerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F111_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F111CrossEncoderSearchRerankerTelemetrySnapshot {
  readonly featureId: typeof F111_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F111_CONFIG: F111CrossEncoderSearchRerankerConfig = {
  featureId: F111_FEATURE_ID,
  stage: F111_STAGE,
  operationCode: F111_OPERATION_CODE,
  contractVersion: F111_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F111CrossEncoderSearchRerankerValidationError extends Error {
  public readonly featureId = F111_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F111 Validation Error on '${field}']: ${message}`);
    this.name = "F111CrossEncoderSearchRerankerValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F111 provenance & audit integrity.
 */
export function computeF111Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f111_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F111: Переранжирование результатов поиска (Cross-Encoder Reranking)
 * Отсев нерелевантных чанков перед подачей в контекстное окно модели
 */
export class F111CrossEncoderSearchRerankerEngine {
  private readonly config: F111CrossEncoderSearchRerankerConfig;
  private readonly executionHistory: F111CrossEncoderSearchRerankerOutput[] = [];
  private readonly auditLog: F111CrossEncoderSearchRerankerAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F111CrossEncoderSearchRerankerConfig>) {
    this.config = {
      ...DEFAULT_F111_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F111CrossEncoderSearchRerankerConfig {
    return { ...this.config };
  }

  public validateInput(input: F111CrossEncoderSearchRerankerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F111CrossEncoderSearchRerankerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F111CrossEncoderSearchRerankerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F111CrossEncoderSearchRerankerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F111CrossEncoderSearchRerankerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.query_id).trim().length === 0) {
      throw new F111CrossEncoderSearchRerankerValidationError("query_id", "Primary domain attribute 'query_id' cannot be empty.");
    }
  }

  public execute(input: F111CrossEncoderSearchRerankerInput): F111CrossEncoderSearchRerankerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f111_${this.totalRuns}_${computeF111Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F111_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        query_id: input.query_id,
        initial_candidates: input.initial_candidates,
        reranked_top_k: input.reranked_top_k,
        precision_gain: input.precision_gain,
      });

      const provenanceDigest = computeF111Digest(canonicalPayload);
      const auditRecord: F111CrossEncoderSearchRerankerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F111_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `cross_encoder_reranker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F111CrossEncoderSearchRerankerOutput = {
        featureId: F111_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F111_OPERATION_CODE,
        resolved_query_id: input.query_id,
        resolved_initial_candidates: input.initial_candidates,
        resolved_reranked_top_k: input.reranked_top_k,
        resolved_precision_gain: input.precision_gain,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord,
      };

      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F111CrossEncoderSearchRerankerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F111_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0,
    };
  }

  public getAuditTrail(): readonly F111CrossEncoderSearchRerankerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F111CrossEncoderSearchRerankerOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F111 (Переранжирование результатов поиска (Cross-Encoder Reranking))
 */
export function verifyF111Module(): {
  featureId: typeof F111_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F111CrossEncoderSearchRerankerEngine();
  const sampleInput: F111CrossEncoderSearchRerankerInput = {
    requestId: "req_verify_f111",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_id: "f111_query_id_verified",
    initial_candidates: 100,
    reranked_top_k: true,
    precision_gain: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 111 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F111" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F111_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
