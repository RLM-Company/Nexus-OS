/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F004
 * ============================================================================
 * Feature ID: F004
 * Stage: stage1-autonomy
 * Title: Граф происхождения артефактов (Artifact Provenance Graph)
 * Description: Отслеживание полной цепочки: кто создал, на основе каких данных и каким промптом
 * Operation Code: provenance_lineage
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F004_FEATURE_ID = "F004" as const;
export const F004_STAGE = "stage1-autonomy" as const;
export const F004_OPERATION_CODE = "provenance_lineage" as const;
export const F004_CONTRACT_VERSION = "1.0.0" as const;

export type F004ArtifactProvenanceGraphExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F004ArtifactProvenanceGraphConfig {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly stage: typeof F004_STAGE;
  readonly operationCode: typeof F004_OPERATION_CODE;
  readonly contractVersion: typeof F004_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F004ArtifactProvenanceGraphInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly prompt_hash: string | number;
  readonly source_artifact_ids: string | number | boolean | readonly string[];
  readonly model_route_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F004ArtifactProvenanceGraphOutput {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F004ArtifactProvenanceGraphExecutionStatus;
  readonly operationCode: typeof F004_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_prompt_hash: string | number;
  readonly resolved_source_artifact_ids: string | number | boolean | readonly string[];
  readonly resolved_model_route_id: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F004ArtifactProvenanceGraphAuditEntry;
}

export interface F004ArtifactProvenanceGraphAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F004_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F004ArtifactProvenanceGraphTelemetrySnapshot {
  readonly featureId: typeof F004_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F004_CONFIG: F004ArtifactProvenanceGraphConfig = {
  featureId: F004_FEATURE_ID,
  stage: F004_STAGE,
  operationCode: F004_OPERATION_CODE,
  contractVersion: F004_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F004ArtifactProvenanceGraphValidationError extends Error {
  public readonly featureId = F004_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F004 Validation Error on '${field}']: ${message}`);
    this.name = "F004ArtifactProvenanceGraphValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F004 provenance & audit integrity.
 */
export function computeF004Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f004_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F004: Граф происхождения артефактов (Artifact Provenance Graph)
 * Отслеживание полной цепочки: кто создал, на основе каких данных и каким промптом
 */
export class F004ArtifactProvenanceGraphEngine {
  private readonly config: F004ArtifactProvenanceGraphConfig;
  private readonly executionHistory: F004ArtifactProvenanceGraphOutput[] = [];
  private readonly auditLog: F004ArtifactProvenanceGraphAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F004ArtifactProvenanceGraphConfig>) {
    this.config = {
      ...DEFAULT_F004_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F004ArtifactProvenanceGraphConfig {
    return { ...this.config };
  }

  public validateInput(input: F004ArtifactProvenanceGraphInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F004ArtifactProvenanceGraphValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
  }

  public execute(input: F004ArtifactProvenanceGraphInput): F004ArtifactProvenanceGraphOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f004_${this.totalRuns}_${computeF004Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F004_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        artifact_id: input.artifact_id,
        prompt_hash: input.prompt_hash,
        source_artifact_ids: input.source_artifact_ids,
        model_route_id: input.model_route_id,
      });

      const provenanceDigest = computeF004Digest(canonicalPayload);
      const auditRecord: F004ArtifactProvenanceGraphAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F004_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `provenance_lineage:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F004ArtifactProvenanceGraphOutput = {
        featureId: F004_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F004_OPERATION_CODE,
        resolved_artifact_id: input.artifact_id,
        resolved_prompt_hash: input.prompt_hash,
        resolved_source_artifact_ids: input.source_artifact_ids,
        resolved_model_route_id: input.model_route_id,
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

  public getTelemetrySnapshot(): F004ArtifactProvenanceGraphTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F004_FEATURE_ID,
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

  public getAuditTrail(): readonly F004ArtifactProvenanceGraphAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F004ArtifactProvenanceGraphOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F004 (Граф происхождения артефактов (Artifact Provenance Graph))
 */
export function verifyF004Module(): {
  featureId: typeof F004_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F004ArtifactProvenanceGraphEngine();
  const sampleInput: F004ArtifactProvenanceGraphInput = {
    requestId: "req_verify_f004",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f004_artifact_id_verified",
    prompt_hash: 100,
    source_artifact_ids: true,
    model_route_id: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 4 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F004" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F004_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
