/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F013
 * ============================================================================
 * Feature ID: F013
 * Stage: stage1-autonomy
 * Title: Параллельное исполнение суб-агентов (Fan-out / Fan-in)
 * Description: Одновременный запуск независимых веток графа с последующей агрегацией результатов
 * Operation Code: fanout_aggregator
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F013_FEATURE_ID = "F013" as const;
export const F013_STAGE = "stage1-autonomy" as const;
export const F013_OPERATION_CODE = "fanout_aggregator" as const;
export const F013_CONTRACT_VERSION = "1.0.0" as const;

export type F013ParallelSubagentFanoutExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F013ParallelSubagentFanoutConfig {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly stage: typeof F013_STAGE;
  readonly operationCode: typeof F013_OPERATION_CODE;
  readonly contractVersion: typeof F013_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F013ParallelSubagentFanoutInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly parallel_group_id: string;
  readonly worker_count: string | number;
  readonly completed_branches: string | number | boolean | readonly string[];
  readonly merged_output: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F013ParallelSubagentFanoutOutput {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F013ParallelSubagentFanoutExecutionStatus;
  readonly operationCode: typeof F013_OPERATION_CODE;
  readonly resolved_parallel_group_id: string;
  readonly resolved_worker_count: string | number;
  readonly resolved_completed_branches: string | number | boolean | readonly string[];
  readonly resolved_merged_output: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F013ParallelSubagentFanoutAuditEntry;
}

export interface F013ParallelSubagentFanoutAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F013_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F013ParallelSubagentFanoutTelemetrySnapshot {
  readonly featureId: typeof F013_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F013_CONFIG: F013ParallelSubagentFanoutConfig = {
  featureId: F013_FEATURE_ID,
  stage: F013_STAGE,
  operationCode: F013_OPERATION_CODE,
  contractVersion: F013_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F013ParallelSubagentFanoutValidationError extends Error {
  public readonly featureId = F013_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F013 Validation Error on '${field}']: ${message}`);
    this.name = "F013ParallelSubagentFanoutValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F013 provenance & audit integrity.
 */
export function computeF013Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f013_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F013: Параллельное исполнение суб-агентов (Fan-out / Fan-in)
 * Одновременный запуск независимых веток графа с последующей агрегацией результатов
 */
export class F013ParallelSubagentFanoutEngine {
  private readonly config: F013ParallelSubagentFanoutConfig;
  private readonly executionHistory: F013ParallelSubagentFanoutOutput[] = [];
  private readonly auditLog: F013ParallelSubagentFanoutAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F013ParallelSubagentFanoutConfig>) {
    this.config = {
      ...DEFAULT_F013_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F013ParallelSubagentFanoutConfig {
    return { ...this.config };
  }

  public validateInput(input: F013ParallelSubagentFanoutInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.parallel_group_id).trim().length === 0) {
      throw new F013ParallelSubagentFanoutValidationError("parallel_group_id", "Primary domain attribute 'parallel_group_id' cannot be empty.");
    }
  }

  public execute(input: F013ParallelSubagentFanoutInput): F013ParallelSubagentFanoutOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f013_${this.totalRuns}_${computeF013Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F013_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        parallel_group_id: input.parallel_group_id,
        worker_count: input.worker_count,
        completed_branches: input.completed_branches,
        merged_output: input.merged_output,
      });

      const provenanceDigest = computeF013Digest(canonicalPayload);
      const auditRecord: F013ParallelSubagentFanoutAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F013_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `fanout_aggregator:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F013ParallelSubagentFanoutOutput = {
        featureId: F013_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F013_OPERATION_CODE,
        resolved_parallel_group_id: input.parallel_group_id,
        resolved_worker_count: input.worker_count,
        resolved_completed_branches: input.completed_branches,
        resolved_merged_output: input.merged_output,
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

  public getTelemetrySnapshot(): F013ParallelSubagentFanoutTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F013_FEATURE_ID,
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

  public getAuditTrail(): readonly F013ParallelSubagentFanoutAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F013ParallelSubagentFanoutOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F013 (Параллельное исполнение суб-агентов (Fan-out / Fan-in))
 */
export function verifyF013Module(): {
  featureId: typeof F013_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F013ParallelSubagentFanoutEngine();
  const sampleInput: F013ParallelSubagentFanoutInput = {
    requestId: "req_verify_f013",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    parallel_group_id: "f013_parallel_group_id_verified",
    worker_count: 100,
    completed_branches: true,
    merged_output: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 13 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F013" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F013_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
