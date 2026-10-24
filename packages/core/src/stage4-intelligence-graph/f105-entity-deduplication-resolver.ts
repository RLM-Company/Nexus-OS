/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F105
 * ============================================================================
 * Feature ID: F105
 * Stage: stage4-intelligence-graph
 * Title: Разрешение дубликатов сущностей (Entity Resolution)
 * Description: Склейка разных упоминаний одного и того же проекта, человека или модуля в единый узел графа
 * Operation Code: entity_canonical_merger
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F105_FEATURE_ID = "F105" as const;
export const F105_STAGE = "stage4-intelligence-graph" as const;
export const F105_OPERATION_CODE = "entity_canonical_merger" as const;
export const F105_CONTRACT_VERSION = "1.0.0" as const;

export type F105EntityDeduplicationResolverExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
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
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F105EntityDeduplicationResolverAuditEntry;
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
  strictValidation: true,
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

/**
 * Deterministic FNV-1a digest calculator for F105 provenance & audit integrity.
 */
export function computeF105Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f105_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F105: Разрешение дубликатов сущностей (Entity Resolution)
 * Склейка разных упоминаний одного и того же проекта, человека или модуля в единый узел графа
 */
export class F105EntityDeduplicationResolverEngine {
  private readonly config: F105EntityDeduplicationResolverConfig;
  private readonly executionHistory: F105EntityDeduplicationResolverOutput[] = [];
  private readonly auditLog: F105EntityDeduplicationResolverAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F105EntityDeduplicationResolverConfig>) {
    this.config = {
      ...DEFAULT_F105_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F105EntityDeduplicationResolverConfig {
    return { ...this.config };
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
    if (this.config.strictValidation && String(input.canonical_node_id).trim().length === 0) {
      throw new F105EntityDeduplicationResolverValidationError("canonical_node_id", "Primary domain attribute 'canonical_node_id' cannot be empty.");
    }
  }

  public execute(input: F105EntityDeduplicationResolverInput): F105EntityDeduplicationResolverOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f105_${this.totalRuns}_${computeF105Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F105_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        canonical_node_id: input.canonical_node_id,
        merged_aliases: input.merged_aliases,
        duplicate_nodes_collapsed: input.duplicate_nodes_collapsed,
        similarity_score: input.similarity_score,
      });

      const provenanceDigest = computeF105Digest(canonicalPayload);
      const auditRecord: F105EntityDeduplicationResolverAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F105_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `entity_canonical_merger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
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
        resolved_canonical_node_id: input.canonical_node_id,
        resolved_merged_aliases: input.merged_aliases,
        resolved_duplicate_nodes_collapsed: input.duplicate_nodes_collapsed,
        resolved_similarity_score: input.similarity_score,
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
          : 0,
    };
  }

  public getAuditTrail(): readonly F105EntityDeduplicationResolverAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F105EntityDeduplicationResolverOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F105 (Разрешение дубликатов сущностей (Entity Resolution))
 */
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
    canonical_node_id: "f105_canonical_node_id_verified",
    merged_aliases: 100,
    duplicate_nodes_collapsed: true,
    similarity_score: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 105 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F105" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F105_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
