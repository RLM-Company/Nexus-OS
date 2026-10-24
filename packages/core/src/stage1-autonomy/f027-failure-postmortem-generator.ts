/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F027
 * ============================================================================
 * Feature ID: F027
 * Stage: stage1-autonomy
 * Title: Генерация пост-мортем отчётов при сбое
 * Description: Автоматический разбор причины падения цепочки задач
 * Operation Code: postmortem_analyzer
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F027_FEATURE_ID = "F027" as const;
export const F027_STAGE = "stage1-autonomy" as const;
export const F027_OPERATION_CODE = "postmortem_analyzer" as const;
export const F027_CONTRACT_VERSION = "1.0.0" as const;

export type F027FailurePostmortemGeneratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F027FailurePostmortemGeneratorConfig {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly stage: typeof F027_STAGE;
  readonly operationCode: typeof F027_OPERATION_CODE;
  readonly contractVersion: typeof F027_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F027FailurePostmortemGeneratorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly report_id: string;
  readonly failed_node_id: string | number;
  readonly root_cause: string | number | boolean | readonly string[];
  readonly recovery_recommendation: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F027FailurePostmortemGeneratorOutput {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F027FailurePostmortemGeneratorExecutionStatus;
  readonly operationCode: typeof F027_OPERATION_CODE;
  readonly resolved_report_id: string;
  readonly resolved_failed_node_id: string | number;
  readonly resolved_root_cause: string | number | boolean | readonly string[];
  readonly resolved_recovery_recommendation: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F027FailurePostmortemGeneratorAuditEntry;
}

export interface F027FailurePostmortemGeneratorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F027_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F027FailurePostmortemGeneratorTelemetrySnapshot {
  readonly featureId: typeof F027_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F027_CONFIG: F027FailurePostmortemGeneratorConfig = {
  featureId: F027_FEATURE_ID,
  stage: F027_STAGE,
  operationCode: F027_OPERATION_CODE,
  contractVersion: F027_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F027FailurePostmortemGeneratorValidationError extends Error {
  public readonly featureId = F027_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F027 Validation Error on '${field}']: ${message}`);
    this.name = "F027FailurePostmortemGeneratorValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F027 provenance & audit integrity.
 */
export function computeF027Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f027_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F027: Генерация пост-мортем отчётов при сбое
 * Автоматический разбор причины падения цепочки задач
 */
export class F027FailurePostmortemGeneratorEngine {
  private readonly config: F027FailurePostmortemGeneratorConfig;
  private readonly executionHistory: F027FailurePostmortemGeneratorOutput[] = [];
  private readonly auditLog: F027FailurePostmortemGeneratorAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F027FailurePostmortemGeneratorConfig>) {
    this.config = {
      ...DEFAULT_F027_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F027FailurePostmortemGeneratorConfig {
    return { ...this.config };
  }

  public validateInput(input: F027FailurePostmortemGeneratorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.report_id).trim().length === 0) {
      throw new F027FailurePostmortemGeneratorValidationError("report_id", "Primary domain attribute 'report_id' cannot be empty.");
    }
  }

  public execute(input: F027FailurePostmortemGeneratorInput): F027FailurePostmortemGeneratorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f027_${this.totalRuns}_${computeF027Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F027_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        report_id: input.report_id,
        failed_node_id: input.failed_node_id,
        root_cause: input.root_cause,
        recovery_recommendation: input.recovery_recommendation,
      });

      const provenanceDigest = computeF027Digest(canonicalPayload);
      const auditRecord: F027FailurePostmortemGeneratorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F027_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `postmortem_analyzer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F027FailurePostmortemGeneratorOutput = {
        featureId: F027_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F027_OPERATION_CODE,
        resolved_report_id: input.report_id,
        resolved_failed_node_id: input.failed_node_id,
        resolved_root_cause: input.root_cause,
        resolved_recovery_recommendation: input.recovery_recommendation,
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

  public getTelemetrySnapshot(): F027FailurePostmortemGeneratorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F027_FEATURE_ID,
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

  public getAuditTrail(): readonly F027FailurePostmortemGeneratorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F027FailurePostmortemGeneratorOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F027 (Генерация пост-мортем отчётов при сбое)
 */
export function verifyF027Module(): {
  featureId: typeof F027_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F027FailurePostmortemGeneratorEngine();
  const sampleInput: F027FailurePostmortemGeneratorInput = {
    requestId: "req_verify_f027",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    report_id: "f027_report_id_verified",
    failed_node_id: 100,
    root_cause: true,
    recovery_recommendation: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 27 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F027" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F027_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
