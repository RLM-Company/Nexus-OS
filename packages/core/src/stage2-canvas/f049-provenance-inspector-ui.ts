/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F049
 * ============================================================================
 * Feature ID: F049
 * Stage: stage2-canvas
 * Title: Инспектор цепочки происхождения (Provenance Inspector UI)
 * Description: Боковая панель, показывающая, из каких чанков документов и задач родился текущий артефакт
 * Operation Code: provenance_drawer
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F049_FEATURE_ID = "F049" as const;
export const F049_STAGE = "stage2-canvas" as const;
export const F049_OPERATION_CODE = "provenance_drawer" as const;
export const F049_CONTRACT_VERSION = "1.0.0" as const;

export type F049ProvenanceInspectorUiExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F049ProvenanceInspectorUiConfig {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly stage: typeof F049_STAGE;
  readonly operationCode: typeof F049_OPERATION_CODE;
  readonly contractVersion: typeof F049_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F049ProvenanceInspectorUiInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly upstream_tasks: string | number;
  readonly source_chunks: string | number | boolean | readonly string[];
  readonly lineage_depth: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F049ProvenanceInspectorUiOutput {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F049ProvenanceInspectorUiExecutionStatus;
  readonly operationCode: typeof F049_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_upstream_tasks: string | number;
  readonly resolved_source_chunks: string | number | boolean | readonly string[];
  readonly resolved_lineage_depth: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F049ProvenanceInspectorUiAuditEntry;
}

export interface F049ProvenanceInspectorUiAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F049_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F049ProvenanceInspectorUiTelemetrySnapshot {
  readonly featureId: typeof F049_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F049_CONFIG: F049ProvenanceInspectorUiConfig = {
  featureId: F049_FEATURE_ID,
  stage: F049_STAGE,
  operationCode: F049_OPERATION_CODE,
  contractVersion: F049_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F049ProvenanceInspectorUiValidationError extends Error {
  public readonly featureId = F049_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F049 Validation Error on '${field}']: ${message}`);
    this.name = "F049ProvenanceInspectorUiValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F049 provenance & audit integrity.
 */
export function computeF049Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f049_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F049: Инспектор цепочки происхождения (Provenance Inspector UI)
 * Боковая панель, показывающая, из каких чанков документов и задач родился текущий артефакт
 */
export class F049ProvenanceInspectorUiEngine {
  private readonly config: F049ProvenanceInspectorUiConfig;
  private readonly executionHistory: F049ProvenanceInspectorUiOutput[] = [];
  private readonly auditLog: F049ProvenanceInspectorUiAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F049ProvenanceInspectorUiConfig>) {
    this.config = {
      ...DEFAULT_F049_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F049ProvenanceInspectorUiConfig {
    return { ...this.config };
  }

  public validateInput(input: F049ProvenanceInspectorUiInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F049ProvenanceInspectorUiValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
  }

  public execute(input: F049ProvenanceInspectorUiInput): F049ProvenanceInspectorUiOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f049_${this.totalRuns}_${computeF049Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F049_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        artifact_id: input.artifact_id,
        upstream_tasks: input.upstream_tasks,
        source_chunks: input.source_chunks,
        lineage_depth: input.lineage_depth,
      });

      const provenanceDigest = computeF049Digest(canonicalPayload);
      const auditRecord: F049ProvenanceInspectorUiAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F049_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `provenance_drawer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F049ProvenanceInspectorUiOutput = {
        featureId: F049_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F049_OPERATION_CODE,
        resolved_artifact_id: input.artifact_id,
        resolved_upstream_tasks: input.upstream_tasks,
        resolved_source_chunks: input.source_chunks,
        resolved_lineage_depth: input.lineage_depth,
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

  public getTelemetrySnapshot(): F049ProvenanceInspectorUiTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F049_FEATURE_ID,
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

  public getAuditTrail(): readonly F049ProvenanceInspectorUiAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F049ProvenanceInspectorUiOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F049 (Инспектор цепочки происхождения (Provenance Inspector UI))
 */
export function verifyF049Module(): {
  featureId: typeof F049_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F049ProvenanceInspectorUiEngine();
  const sampleInput: F049ProvenanceInspectorUiInput = {
    requestId: "req_verify_f049",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f049_artifact_id_verified",
    upstream_tasks: 100,
    source_chunks: true,
    lineage_depth: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 49 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F049" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F049_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
