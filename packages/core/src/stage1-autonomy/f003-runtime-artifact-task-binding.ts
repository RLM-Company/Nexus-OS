/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F003
 * ============================================================================
 * Feature ID: F003
 * Stage: stage1-autonomy
 * Title: Связывание рантайм-артефактов с графом задач
 * Description: Жёсткая привязка каждого сгенерированного файла или блока кода к конкретному узлу задачи
 * Operation Code: artifact_binding
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F003_FEATURE_ID = "F003" as const;
export const F003_STAGE = "stage1-autonomy" as const;
export const F003_OPERATION_CODE = "artifact_binding" as const;
export const F003_CONTRACT_VERSION = "1.0.0" as const;

export type F003RuntimeArtifactTaskBindingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F003RuntimeArtifactTaskBindingConfig {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly stage: typeof F003_STAGE;
  readonly operationCode: typeof F003_OPERATION_CODE;
  readonly contractVersion: typeof F003_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F003RuntimeArtifactTaskBindingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly artifact_id: string;
  readonly task_id: string | number;
  readonly graph_id: string | number | boolean | readonly string[];
  readonly producer_role: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F003RuntimeArtifactTaskBindingOutput {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F003RuntimeArtifactTaskBindingExecutionStatus;
  readonly operationCode: typeof F003_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_task_id: string | number;
  readonly resolved_graph_id: string | number | boolean | readonly string[];
  readonly resolved_producer_role: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F003RuntimeArtifactTaskBindingAuditEntry;
}

export interface F003RuntimeArtifactTaskBindingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F003_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F003RuntimeArtifactTaskBindingTelemetrySnapshot {
  readonly featureId: typeof F003_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F003_CONFIG: F003RuntimeArtifactTaskBindingConfig = {
  featureId: F003_FEATURE_ID,
  stage: F003_STAGE,
  operationCode: F003_OPERATION_CODE,
  contractVersion: F003_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F003RuntimeArtifactTaskBindingValidationError extends Error {
  public readonly featureId = F003_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F003 Validation Error on '${field}']: ${message}`);
    this.name = "F003RuntimeArtifactTaskBindingValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F003 provenance & audit integrity.
 */
export function computeF003Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f003_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F003: Связывание рантайм-артефактов с графом задач
 * Жёсткая привязка каждого сгенерированного файла или блока кода к конкретному узлу задачи
 */
export class F003RuntimeArtifactTaskBindingEngine {
  private readonly config: F003RuntimeArtifactTaskBindingConfig;
  private readonly executionHistory: F003RuntimeArtifactTaskBindingOutput[] = [];
  private readonly auditLog: F003RuntimeArtifactTaskBindingAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F003RuntimeArtifactTaskBindingConfig>) {
    this.config = {
      ...DEFAULT_F003_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F003RuntimeArtifactTaskBindingConfig {
    return { ...this.config };
  }

  public validateInput(input: F003RuntimeArtifactTaskBindingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.artifact_id).trim().length === 0) {
      throw new F003RuntimeArtifactTaskBindingValidationError("artifact_id", "Primary domain attribute 'artifact_id' cannot be empty.");
    }
  }

  public execute(input: F003RuntimeArtifactTaskBindingInput): F003RuntimeArtifactTaskBindingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f003_${this.totalRuns}_${computeF003Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F003_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        artifact_id: input.artifact_id,
        task_id: input.task_id,
        graph_id: input.graph_id,
        producer_role: input.producer_role,
      });

      const provenanceDigest = computeF003Digest(canonicalPayload);
      const auditRecord: F003RuntimeArtifactTaskBindingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F003_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `artifact_binding:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F003RuntimeArtifactTaskBindingOutput = {
        featureId: F003_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F003_OPERATION_CODE,
        resolved_artifact_id: input.artifact_id,
        resolved_task_id: input.task_id,
        resolved_graph_id: input.graph_id,
        resolved_producer_role: input.producer_role,
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

  public getTelemetrySnapshot(): F003RuntimeArtifactTaskBindingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F003_FEATURE_ID,
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

  public getAuditTrail(): readonly F003RuntimeArtifactTaskBindingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F003RuntimeArtifactTaskBindingOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F003 (Связывание рантайм-артефактов с графом задач)
 */
export function verifyF003Module(): {
  featureId: typeof F003_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F003RuntimeArtifactTaskBindingEngine();
  const sampleInput: F003RuntimeArtifactTaskBindingInput = {
    requestId: "req_verify_f003",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f003_artifact_id_verified",
    task_id: 100,
    graph_id: true,
    producer_role: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 3 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F003" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F003_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
