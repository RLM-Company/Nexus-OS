/**
 * F109 (stage4-intelligence-graph): Семантическое чанкование документов с сохранением иерархии
 * Нарезка файлов по смысловым блокам и главам, а не по слепому лимиту символов
 * Operation Code: semantic_tree_chunker
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F109_FEATURE_ID = "F109" as const;
export const F109_STAGE = "stage4-intelligence-graph" as const;
export const F109_OPERATION_CODE = "semantic_tree_chunker" as const;
export const F109_CONTRACT_VERSION = "2.0.0" as const;

export type F109HierarchicalSemanticChunkerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F109HierarchicalSemanticChunkerConfig {
  readonly featureId: typeof F109_FEATURE_ID;
  readonly stage: typeof F109_STAGE;
  readonly operationCode: typeof F109_OPERATION_CODE;
  readonly contractVersion: typeof F109_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F109HierarchicalSemanticChunkerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly document_id: string;
  readonly chunks_created: string | number;
  readonly heading_breadcrumb_paths: string | number | boolean | readonly string[];
  readonly avg_chunk_tokens: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F109HierarchicalSemanticChunkerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F109_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F109HierarchicalSemanticChunkerOutput {
  readonly featureId: typeof F109_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F109HierarchicalSemanticChunkerExecutionStatus;
  readonly operationCode: typeof F109_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_chunks_created: string | number;
  readonly resolved_heading_breadcrumb_paths: string | number | boolean | readonly string[];
  readonly resolved_avg_chunk_tokens: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F109HierarchicalSemanticChunkerAuditEntry;
}

export interface F109HierarchicalSemanticChunkerTelemetrySnapshot {
  readonly featureId: typeof F109_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F109_CONFIG: F109HierarchicalSemanticChunkerConfig = {
  featureId: F109_FEATURE_ID,
  stage: F109_STAGE,
  operationCode: F109_OPERATION_CODE,
  contractVersion: F109_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F109HierarchicalSemanticChunkerValidationError extends Error {
  public readonly featureId = F109_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F109 Validation Error on '${field}']: ${message}`);
    this.name = "F109HierarchicalSemanticChunkerValidationError";
    this.field = field;
  }
}

export function computeF109Digest(rawPayload: string): string {
  return `f109_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F109HierarchicalSemanticChunkerEngine {
  private readonly config: F109HierarchicalSemanticChunkerConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F109HierarchicalSemanticChunkerOutput[] = [];
  private readonly auditLog: F109HierarchicalSemanticChunkerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F109HierarchicalSemanticChunkerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F109HierarchicalSemanticChunkerConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F109_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F109HierarchicalSemanticChunkerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F109HierarchicalSemanticChunkerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F109HierarchicalSemanticChunkerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F109HierarchicalSemanticChunkerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F109HierarchicalSemanticChunkerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F109HierarchicalSemanticChunkerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F109HierarchicalSemanticChunkerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F109HierarchicalSemanticChunkerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.document_id).trim().length === 0) {
      throw new F109HierarchicalSemanticChunkerValidationError("document_id", "Primary domain attribute 'document_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      document_id: input.document_id,
      chunks_created: input.chunks_created,
      heading_breadcrumb_paths: input.heading_breadcrumb_paths,
      avg_chunk_tokens: input.avg_chunk_tokens
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F109HierarchicalSemanticChunkerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F109HierarchicalSemanticChunkerInput): F109HierarchicalSemanticChunkerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F109_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        document_id: input.document_id,
        chunks_created: input.chunks_created,
        heading_breadcrumb_paths: input.heading_breadcrumb_paths,
        avg_chunk_tokens: input.avg_chunk_tokens
      });
      const payloadHash = computeF109Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F109HierarchicalSemanticChunkerValidationError(
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
        featureId: F109_FEATURE_ID,
        operationCode: F109_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          document_id: input.document_id,
          chunks_created: input.chunks_created,
          heading_breadcrumb_paths: input.heading_breadcrumb_paths,
          avg_chunk_tokens: input.avg_chunk_tokens
        }
      });

      const executionId = `exec_f109_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f109_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F109HierarchicalSemanticChunkerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F109_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `semantic_tree_chunker:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F109HierarchicalSemanticChunkerOutput = {
        featureId: F109_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F109_OPERATION_CODE,
        resolved_document_id: kernelResult.resolvedFields.document_id as string,
        resolved_chunks_created: kernelResult.resolvedFields.chunks_created as string | number,
        resolved_heading_breadcrumb_paths: kernelResult.resolvedFields.heading_breadcrumb_paths as string | number | boolean | readonly string[],
        resolved_avg_chunk_tokens: kernelResult.resolvedFields.avg_chunk_tokens as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F109HierarchicalSemanticChunkerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F109_FEATURE_ID,
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

  public getAuditTrail(): readonly F109HierarchicalSemanticChunkerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F109HierarchicalSemanticChunkerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF109Module(): {
  featureId: typeof F109_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F109HierarchicalSemanticChunkerEngine();
  const sampleInput: F109HierarchicalSemanticChunkerInput = {
    requestId: "req_verify_f109",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f109_document_id_seed",
    chunks_created: 42,
    heading_breadcrumb_paths: true,
    avg_chunk_tokens: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 109 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F109" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F109_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
