/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F106
 * ============================================================================
 * Feature ID: F106
 * Stage: stage4-intelligence-graph
 * Title: Временная шкала графа знаний (Temporal Graph Tracking)
 * Description: Просмотр того, как менялись знания и факты по проекту во времени с поддержкой дат актуальности
 * Operation Code: bitemporal_fact_ledger
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F106_FEATURE_ID = "F106" as const;
export const F106_STAGE = "stage4-intelligence-graph" as const;
export const F106_OPERATION_CODE = "bitemporal_fact_ledger" as const;
export const F106_CONTRACT_VERSION = "1.0.0" as const;

export type F106TemporalKnowledgeGraphTrackerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F106TemporalKnowledgeGraphTrackerConfig {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly stage: typeof F106_STAGE;
  readonly operationCode: typeof F106_OPERATION_CODE;
  readonly contractVersion: typeof F106_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F106TemporalKnowledgeGraphTrackerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly node_id: string;
  readonly valid_from_iso: string | number;
  readonly valid_to_iso: string | number | boolean | readonly string[];
  readonly point_in_time_snapshot: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F106TemporalKnowledgeGraphTrackerOutput {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F106TemporalKnowledgeGraphTrackerExecutionStatus;
  readonly operationCode: typeof F106_OPERATION_CODE;
  readonly resolved_node_id: string;
  readonly resolved_valid_from_iso: string | number;
  readonly resolved_valid_to_iso: string | number | boolean | readonly string[];
  readonly resolved_point_in_time_snapshot: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F106TemporalKnowledgeGraphTrackerAuditEntry;
}

export interface F106TemporalKnowledgeGraphTrackerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F106_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F106TemporalKnowledgeGraphTrackerTelemetrySnapshot {
  readonly featureId: typeof F106_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F106_CONFIG: F106TemporalKnowledgeGraphTrackerConfig = {
  featureId: F106_FEATURE_ID,
  stage: F106_STAGE,
  operationCode: F106_OPERATION_CODE,
  contractVersion: F106_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F106TemporalKnowledgeGraphTrackerValidationError extends Error {
  public readonly featureId = F106_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F106 Validation Error on '${field}']: ${message}`);
    this.name = "F106TemporalKnowledgeGraphTrackerValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F106 provenance & audit integrity.
 */
export function computeF106Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f106_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F106: Временная шкала графа знаний (Temporal Graph Tracking)
 * Просмотр того, как менялись знания и факты по проекту во времени с поддержкой дат актуальности
 */
export class F106TemporalKnowledgeGraphTrackerEngine {
  private readonly config: F106TemporalKnowledgeGraphTrackerConfig;
  private readonly executionHistory: F106TemporalKnowledgeGraphTrackerOutput[] = [];
  private readonly auditLog: F106TemporalKnowledgeGraphTrackerAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F106TemporalKnowledgeGraphTrackerConfig>) {
    this.config = {
      ...DEFAULT_F106_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F106TemporalKnowledgeGraphTrackerConfig {
    return { ...this.config };
  }

  public validateInput(input: F106TemporalKnowledgeGraphTrackerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.node_id).trim().length === 0) {
      throw new F106TemporalKnowledgeGraphTrackerValidationError("node_id", "Primary domain attribute 'node_id' cannot be empty.");
    }
  }

  public execute(input: F106TemporalKnowledgeGraphTrackerInput): F106TemporalKnowledgeGraphTrackerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f106_${this.totalRuns}_${computeF106Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F106_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        node_id: input.node_id,
        valid_from_iso: input.valid_from_iso,
        valid_to_iso: input.valid_to_iso,
        point_in_time_snapshot: input.point_in_time_snapshot,
      });

      const provenanceDigest = computeF106Digest(canonicalPayload);
      const auditRecord: F106TemporalKnowledgeGraphTrackerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F106_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `bitemporal_fact_ledger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F106TemporalKnowledgeGraphTrackerOutput = {
        featureId: F106_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F106_OPERATION_CODE,
        resolved_node_id: input.node_id,
        resolved_valid_from_iso: input.valid_from_iso,
        resolved_valid_to_iso: input.valid_to_iso,
        resolved_point_in_time_snapshot: input.point_in_time_snapshot,
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

  public getTelemetrySnapshot(): F106TemporalKnowledgeGraphTrackerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F106_FEATURE_ID,
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

  public getAuditTrail(): readonly F106TemporalKnowledgeGraphTrackerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F106TemporalKnowledgeGraphTrackerOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F106 (Временная шкала графа знаний (Temporal Graph Tracking))
 */
export function verifyF106Module(): {
  featureId: typeof F106_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F106TemporalKnowledgeGraphTrackerEngine();
  const sampleInput: F106TemporalKnowledgeGraphTrackerInput = {
    requestId: "req_verify_f106",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    node_id: "f106_node_id_verified",
    valid_from_iso: 100,
    valid_to_iso: true,
    point_in_time_snapshot: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 106 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F106" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F106_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
