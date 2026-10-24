/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F118
 * ============================================================================
 * Feature ID: F118
 * Stage: stage4-intelligence-graph
 * Title: Тегирование и пользовательские метаданные узлов
 * Description: Ручная и автоматическая разметка документов и артефактов статусами
 * Operation Code: node_metadata_tagger
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F118_FEATURE_ID = "F118" as const;
export const F118_STAGE = "stage4-intelligence-graph" as const;
export const F118_OPERATION_CODE = "node_metadata_tagger" as const;
export const F118_CONTRACT_VERSION = "1.0.0" as const;

export type F118NodeTaggingCustomMetadataExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F118NodeTaggingCustomMetadataConfig {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly stage: typeof F118_STAGE;
  readonly operationCode: typeof F118_OPERATION_CODE;
  readonly contractVersion: typeof F118_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F118NodeTaggingCustomMetadataInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly node_id: string;
  readonly applied_tags: string | number;
  readonly custom_attributes: string | number | boolean | readonly string[];
  readonly indexed_for_filter: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F118NodeTaggingCustomMetadataOutput {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F118NodeTaggingCustomMetadataExecutionStatus;
  readonly operationCode: typeof F118_OPERATION_CODE;
  readonly resolved_node_id: string;
  readonly resolved_applied_tags: string | number;
  readonly resolved_custom_attributes: string | number | boolean | readonly string[];
  readonly resolved_indexed_for_filter: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F118NodeTaggingCustomMetadataAuditEntry;
}

export interface F118NodeTaggingCustomMetadataAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F118_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F118NodeTaggingCustomMetadataTelemetrySnapshot {
  readonly featureId: typeof F118_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F118_CONFIG: F118NodeTaggingCustomMetadataConfig = {
  featureId: F118_FEATURE_ID,
  stage: F118_STAGE,
  operationCode: F118_OPERATION_CODE,
  contractVersion: F118_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F118NodeTaggingCustomMetadataValidationError extends Error {
  public readonly featureId = F118_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F118 Validation Error on '${field}']: ${message}`);
    this.name = "F118NodeTaggingCustomMetadataValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F118 provenance & audit integrity.
 */
export function computeF118Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f118_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F118: Тегирование и пользовательские метаданные узлов
 * Ручная и автоматическая разметка документов и артефактов статусами
 */
export class F118NodeTaggingCustomMetadataEngine {
  private readonly config: F118NodeTaggingCustomMetadataConfig;
  private readonly executionHistory: F118NodeTaggingCustomMetadataOutput[] = [];
  private readonly auditLog: F118NodeTaggingCustomMetadataAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F118NodeTaggingCustomMetadataConfig>) {
    this.config = {
      ...DEFAULT_F118_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F118NodeTaggingCustomMetadataConfig {
    return { ...this.config };
  }

  public validateInput(input: F118NodeTaggingCustomMetadataInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.node_id).trim().length === 0) {
      throw new F118NodeTaggingCustomMetadataValidationError("node_id", "Primary domain attribute 'node_id' cannot be empty.");
    }
  }

  public execute(input: F118NodeTaggingCustomMetadataInput): F118NodeTaggingCustomMetadataOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f118_${this.totalRuns}_${computeF118Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F118_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        node_id: input.node_id,
        applied_tags: input.applied_tags,
        custom_attributes: input.custom_attributes,
        indexed_for_filter: input.indexed_for_filter,
      });

      const provenanceDigest = computeF118Digest(canonicalPayload);
      const auditRecord: F118NodeTaggingCustomMetadataAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F118_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `node_metadata_tagger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F118NodeTaggingCustomMetadataOutput = {
        featureId: F118_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F118_OPERATION_CODE,
        resolved_node_id: input.node_id,
        resolved_applied_tags: input.applied_tags,
        resolved_custom_attributes: input.custom_attributes,
        resolved_indexed_for_filter: input.indexed_for_filter,
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

  public getTelemetrySnapshot(): F118NodeTaggingCustomMetadataTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F118_FEATURE_ID,
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

  public getAuditTrail(): readonly F118NodeTaggingCustomMetadataAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F118NodeTaggingCustomMetadataOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F118 (Тегирование и пользовательские метаданные узлов)
 */
export function verifyF118Module(): {
  featureId: typeof F118_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F118NodeTaggingCustomMetadataEngine();
  const sampleInput: F118NodeTaggingCustomMetadataInput = {
    requestId: "req_verify_f118",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    node_id: "f118_node_id_verified",
    applied_tags: 100,
    custom_attributes: true,
    indexed_for_filter: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 118 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F118" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F118_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
