/**
 * F100 (stage4-intelligence-graph): Гибридный поиск (Vector + Graph + Keyword RAG)
 * Комбинирование семантического поиска по эмбеддингам с обходом графа связей и точным совпадением слов
 * Operation Code: hybrid_rag_retriever
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F100_FEATURE_ID = "F100" as const;
export const F100_STAGE = "stage4-intelligence-graph" as const;
export const F100_OPERATION_CODE = "hybrid_rag_retriever" as const;
export const F100_CONTRACT_VERSION = "2.0.0" as const;

export type F100HybridVectorGraphKeywordRagExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F100HybridVectorGraphKeywordRagConfig {
  readonly featureId: typeof F100_FEATURE_ID;
  readonly stage: typeof F100_STAGE;
  readonly operationCode: typeof F100_OPERATION_CODE;
  readonly contractVersion: typeof F100_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F100HybridVectorGraphKeywordRagInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly query_text: string;
  readonly vector_matches: string | number;
  readonly graph_hop_matches: string | number | boolean | readonly string[];
  readonly fused_ranking: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F100HybridVectorGraphKeywordRagAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F100_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F100HybridVectorGraphKeywordRagOutput {
  readonly featureId: typeof F100_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F100HybridVectorGraphKeywordRagExecutionStatus;
  readonly operationCode: typeof F100_OPERATION_CODE;
  readonly resolved_query_text: string;
  readonly resolved_vector_matches: string | number;
  readonly resolved_graph_hop_matches: string | number | boolean | readonly string[];
  readonly resolved_fused_ranking: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F100HybridVectorGraphKeywordRagAuditEntry;
}

export interface F100HybridVectorGraphKeywordRagTelemetrySnapshot {
  readonly featureId: typeof F100_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F100_CONFIG: F100HybridVectorGraphKeywordRagConfig = {
  featureId: F100_FEATURE_ID,
  stage: F100_STAGE,
  operationCode: F100_OPERATION_CODE,
  contractVersion: F100_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F100HybridVectorGraphKeywordRagValidationError extends Error {
  public readonly featureId = F100_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F100 Validation Error on '${field}']: ${message}`);
    this.name = "F100HybridVectorGraphKeywordRagValidationError";
    this.field = field;
  }
}

export function computeF100Digest(rawPayload: string): string {
  return `f100_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F100HybridVectorGraphKeywordRagEngine {
  private readonly config: F100HybridVectorGraphKeywordRagConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F100HybridVectorGraphKeywordRagOutput[] = [];
  private readonly auditLog: F100HybridVectorGraphKeywordRagAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F100HybridVectorGraphKeywordRagOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F100HybridVectorGraphKeywordRagConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F100_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F100HybridVectorGraphKeywordRagConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F100HybridVectorGraphKeywordRagInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F100HybridVectorGraphKeywordRagValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F100HybridVectorGraphKeywordRagValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F100HybridVectorGraphKeywordRagValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F100HybridVectorGraphKeywordRagValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F100HybridVectorGraphKeywordRagValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F100HybridVectorGraphKeywordRagValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.query_text).trim().length === 0) {
      throw new F100HybridVectorGraphKeywordRagValidationError("query_text", "Primary domain attribute 'query_text' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      query_text: input.query_text,
      vector_matches: input.vector_matches,
      graph_hop_matches: input.graph_hop_matches,
      fused_ranking: input.fused_ranking
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F100HybridVectorGraphKeywordRagValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F100HybridVectorGraphKeywordRagInput): F100HybridVectorGraphKeywordRagOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F100_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        query_text: input.query_text,
        vector_matches: input.vector_matches,
        graph_hop_matches: input.graph_hop_matches,
        fused_ranking: input.fused_ranking
      });
      const payloadHash = computeF100Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F100HybridVectorGraphKeywordRagValidationError(
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
        featureId: F100_FEATURE_ID,
        operationCode: F100_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          query_text: input.query_text,
          vector_matches: input.vector_matches,
          graph_hop_matches: input.graph_hop_matches,
          fused_ranking: input.fused_ranking
        }
      });

      const executionId = `exec_f100_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f100_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F100HybridVectorGraphKeywordRagAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F100_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `hybrid_rag_retriever:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F100HybridVectorGraphKeywordRagOutput = {
        featureId: F100_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F100_OPERATION_CODE,
        resolved_query_text: kernelResult.resolvedFields.query_text as string,
        resolved_vector_matches: kernelResult.resolvedFields.vector_matches as string | number,
        resolved_graph_hop_matches: kernelResult.resolvedFields.graph_hop_matches as string | number | boolean | readonly string[],
        resolved_fused_ranking: kernelResult.resolvedFields.fused_ranking as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F100HybridVectorGraphKeywordRagTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F100_FEATURE_ID,
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

  public getAuditTrail(): readonly F100HybridVectorGraphKeywordRagAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F100HybridVectorGraphKeywordRagOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF100Module(): {
  featureId: typeof F100_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F100HybridVectorGraphKeywordRagEngine();
  const sampleInput: F100HybridVectorGraphKeywordRagInput = {
    requestId: "req_verify_f100",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    query_text: "f100_query_text_seed",
    vector_matches: 42,
    graph_hop_matches: true,
    fused_ranking: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 100 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F100" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_query_text !== sampleInput.query_text &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F100_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
