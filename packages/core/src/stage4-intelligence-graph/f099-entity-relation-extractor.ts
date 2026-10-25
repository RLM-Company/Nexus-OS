/**
 * F099 (stage4-intelligence-graph): Автоматическое извлечение сущностей и связей (Entity & Relation Extraction)
 * Пополнение графа при загрузке любого нового файла или завершении диалога
 * Operation Code: ner_relation_miner
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F099_FEATURE_ID = "F099" as const;
export const F099_STAGE = "stage4-intelligence-graph" as const;
export const F099_OPERATION_CODE = "ner_relation_miner" as const;
export const F099_CONTRACT_VERSION = "2.0.0" as const;

export type F099EntityRelationExtractorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F099EntityRelationExtractorConfig {
  readonly featureId: typeof F099_FEATURE_ID;
  readonly stage: typeof F099_STAGE;
  readonly operationCode: typeof F099_OPERATION_CODE;
  readonly contractVersion: typeof F099_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F099EntityRelationExtractorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_id: string;
  readonly extracted_entities: string | number;
  readonly extracted_relations: string | number | boolean | readonly string[];
  readonly graph_updated: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F099EntityRelationExtractorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F099_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F099EntityRelationExtractorOutput {
  readonly featureId: typeof F099_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F099EntityRelationExtractorExecutionStatus;
  readonly operationCode: typeof F099_OPERATION_CODE;
  readonly resolved_source_id: string;
  readonly resolved_extracted_entities: string | number;
  readonly resolved_extracted_relations: string | number | boolean | readonly string[];
  readonly resolved_graph_updated: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F099EntityRelationExtractorAuditEntry;
}

export interface F099EntityRelationExtractorTelemetrySnapshot {
  readonly featureId: typeof F099_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F099_CONFIG: F099EntityRelationExtractorConfig = {
  featureId: F099_FEATURE_ID,
  stage: F099_STAGE,
  operationCode: F099_OPERATION_CODE,
  contractVersion: F099_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F099EntityRelationExtractorValidationError extends Error {
  public readonly featureId = F099_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F099 Validation Error on '${field}']: ${message}`);
    this.name = "F099EntityRelationExtractorValidationError";
    this.field = field;
  }
}

export function computeF099Digest(rawPayload: string): string {
  return `f099_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F099EntityRelationExtractorEngine {
  private readonly config: F099EntityRelationExtractorConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F099EntityRelationExtractorOutput[] = [];
  private readonly auditLog: F099EntityRelationExtractorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F099EntityRelationExtractorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F099EntityRelationExtractorConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F099_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F099EntityRelationExtractorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F099EntityRelationExtractorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F099EntityRelationExtractorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F099EntityRelationExtractorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F099EntityRelationExtractorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F099EntityRelationExtractorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F099EntityRelationExtractorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F099EntityRelationExtractorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.source_id).trim().length === 0) {
      throw new F099EntityRelationExtractorValidationError("source_id", "Primary domain attribute 'source_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      source_id: input.source_id,
      extracted_entities: input.extracted_entities,
      extracted_relations: input.extracted_relations,
      graph_updated: input.graph_updated
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F099EntityRelationExtractorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F099EntityRelationExtractorInput): F099EntityRelationExtractorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F099_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        source_id: input.source_id,
        extracted_entities: input.extracted_entities,
        extracted_relations: input.extracted_relations,
        graph_updated: input.graph_updated
      });
      const payloadHash = computeF099Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F099EntityRelationExtractorValidationError(
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
        featureId: F099_FEATURE_ID,
        operationCode: F099_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          source_id: input.source_id,
          extracted_entities: input.extracted_entities,
          extracted_relations: input.extracted_relations,
          graph_updated: input.graph_updated
        }
      });

      const executionId = `exec_f099_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f099_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F099EntityRelationExtractorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F099_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ner_relation_miner:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F099EntityRelationExtractorOutput = {
        featureId: F099_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F099_OPERATION_CODE,
        resolved_source_id: kernelResult.resolvedFields.source_id as string,
        resolved_extracted_entities: kernelResult.resolvedFields.extracted_entities as string | number,
        resolved_extracted_relations: kernelResult.resolvedFields.extracted_relations as string | number | boolean | readonly string[],
        resolved_graph_updated: kernelResult.resolvedFields.graph_updated as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F099EntityRelationExtractorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F099_FEATURE_ID,
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

  public getAuditTrail(): readonly F099EntityRelationExtractorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F099EntityRelationExtractorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF099Module(): {
  featureId: typeof F099_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F099EntityRelationExtractorEngine();
  const sampleInput: F099EntityRelationExtractorInput = {
    requestId: "req_verify_f099",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_id: "f099_source_id_seed",
    extracted_entities: 42,
    extracted_relations: true,
    graph_updated: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 99 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F099" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_id !== sampleInput.source_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F099_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
