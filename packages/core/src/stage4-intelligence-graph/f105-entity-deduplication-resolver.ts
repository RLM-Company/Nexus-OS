/**
 * F105 (stage4-intelligence-graph): Разрешение дубликатов сущностей (Entity Resolution)
 * Склейка разных упоминаний одного и того же проекта, человека или модуля в единый узел графа
 * Operation Code: entity_canonical_merger
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F105_FEATURE_ID = "F105" as const;
export const F105_STAGE = "stage4-intelligence-graph" as const;
export const F105_OPERATION_CODE = "entity_canonical_merger" as const;
export const F105_CONTRACT_VERSION = "2.0.0" as const;

export type F105EntityDeduplicationResolverExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F105EntityDeduplicationResolverConfig {
  readonly featureId: typeof F105_FEATURE_ID;
  readonly stage: typeof F105_STAGE;
  readonly operationCode: typeof F105_OPERATION_CODE;
  readonly contractVersion: typeof F105_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F105EntityDeduplicationResolverInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly canonical_node_id: string;
  readonly merged_aliases: string | number;
  readonly duplicate_nodes_collapsed: string | number | boolean | readonly string[];
  readonly similarity_score: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F105EntityDeduplicationResolverAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F105_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F105EntityDeduplicationResolverOutput {
  readonly featureId: typeof F105_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F105EntityDeduplicationResolverExecutionStatus;
  readonly operationCode: typeof F105_OPERATION_CODE;
  readonly resolved_canonical_node_id: string;
  readonly resolved_merged_aliases: string | number;
  readonly resolved_duplicate_nodes_collapsed: string | number | boolean | readonly string[];
  readonly resolved_similarity_score: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F105EntityDeduplicationResolverAuditEntry;
}

export interface F105EntityDeduplicationResolverTelemetrySnapshot {
  readonly featureId: typeof F105_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F105_CONFIG: F105EntityDeduplicationResolverConfig = {
  featureId: F105_FEATURE_ID,
  stage: F105_STAGE,
  operationCode: F105_OPERATION_CODE,
  contractVersion: F105_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F105EntityDeduplicationResolverValidationError extends Error {
  public readonly featureId = F105_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F105 Validation Error on '${field}']: ${message}`);
    this.name = "F105EntityDeduplicationResolverValidationError";
    this.field = field;
  }
}

export function computeF105Digest(rawPayload: string): string {
  return `f105_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F105EntityDeduplicationResolverEngine {
  private readonly config: F105EntityDeduplicationResolverConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F105EntityDeduplicationResolverOutput[] = [];
  private readonly auditLog: F105EntityDeduplicationResolverAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F105EntityDeduplicationResolverOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F105EntityDeduplicationResolverConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F105_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F105EntityDeduplicationResolverConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F105EntityDeduplicationResolverInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F105EntityDeduplicationResolverValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.canonical_node_id).trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("canonical_node_id", "Primary domain attribute 'canonical_node_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      canonical_node_id: input.canonical_node_id,
      merged_aliases: input.merged_aliases,
      duplicate_nodes_collapsed: input.duplicate_nodes_collapsed,
      similarity_score: input.similarity_score
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F105EntityDeduplicationResolverValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F105EntityDeduplicationResolverInput): F105EntityDeduplicationResolverOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F105_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        canonical_node_id: input.canonical_node_id,
        merged_aliases: input.merged_aliases,
        duplicate_nodes_collapsed: input.duplicate_nodes_collapsed,
        similarity_score: input.similarity_score
      });
      const payloadHash = computeF105Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F105EntityDeduplicationResolverValidationError(
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
        featureId: F105_FEATURE_ID,
        operationCode: F105_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          canonical_node_id: input.canonical_node_id,
          merged_aliases: input.merged_aliases,
          duplicate_nodes_collapsed: input.duplicate_nodes_collapsed,
          similarity_score: input.similarity_score
        }
      });

      const executionId = `exec_f105_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f105_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F105EntityDeduplicationResolverAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F105_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `entity_canonical_merger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F105EntityDeduplicationResolverOutput = {
        featureId: F105_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F105_OPERATION_CODE,
        resolved_canonical_node_id: kernelResult.resolvedFields.canonical_node_id as string,
        resolved_merged_aliases: kernelResult.resolvedFields.merged_aliases as string | number,
        resolved_duplicate_nodes_collapsed: kernelResult.resolvedFields.duplicate_nodes_collapsed as string | number | boolean | readonly string[],
        resolved_similarity_score: kernelResult.resolvedFields.similarity_score as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F105EntityDeduplicationResolverTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F105_FEATURE_ID,
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

  public getAuditTrail(): readonly F105EntityDeduplicationResolverAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F105EntityDeduplicationResolverOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF105Module(): {
  featureId: typeof F105_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F105EntityDeduplicationResolverEngine();
  const sampleInput: F105EntityDeduplicationResolverInput = {
    requestId: "req_verify_f105",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    canonical_node_id: "f105_canonical_node_id_seed",
    merged_aliases: 42,
    duplicate_nodes_collapsed: true,
    similarity_score: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 105 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F105" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_canonical_node_id !== sampleInput.canonical_node_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F105_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
