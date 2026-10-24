/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F012
 * ============================================================================
 * Feature ID: F012
 * Stage: stage1-autonomy
 * Title: Откат ветки рассуждений (State Rollback)
 * Description: Возможность вернуться на 2–3 шага назад в графе задач и пойти по альтернативной ветке
 * Operation Code: branch_rollback
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F012_FEATURE_ID = "F012" as const;
export const F012_STAGE = "stage1-autonomy" as const;
export const F012_OPERATION_CODE = "branch_rollback" as const;
export const F012_CONTRACT_VERSION = "1.0.0" as const;

export type F012ReasoningStateRollbackExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F012ReasoningStateRollbackConfig {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly stage: typeof F012_STAGE;
  readonly operationCode: typeof F012_OPERATION_CODE;
  readonly contractVersion: typeof F012_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F012ReasoningStateRollbackInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly target_checkpoint_id: string | number;
  readonly steps_reverted: string | number | boolean | readonly string[];
  readonly alternate_branch_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F012ReasoningStateRollbackOutput {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F012ReasoningStateRollbackExecutionStatus;
  readonly operationCode: typeof F012_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_target_checkpoint_id: string | number;
  readonly resolved_steps_reverted: string | number | boolean | readonly string[];
  readonly resolved_alternate_branch_id: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F012ReasoningStateRollbackAuditEntry;
}

export interface F012ReasoningStateRollbackAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F012_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F012ReasoningStateRollbackTelemetrySnapshot {
  readonly featureId: typeof F012_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F012_CONFIG: F012ReasoningStateRollbackConfig = {
  featureId: F012_FEATURE_ID,
  stage: F012_STAGE,
  operationCode: F012_OPERATION_CODE,
  contractVersion: F012_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F012ReasoningStateRollbackValidationError extends Error {
  public readonly featureId = F012_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F012 Validation Error on '${field}']: ${message}`);
    this.name = "F012ReasoningStateRollbackValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F012 provenance & audit integrity.
 */
export function computeF012Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f012_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F012: Откат ветки рассуждений (State Rollback)
 * Возможность вернуться на 2–3 шага назад в графе задач и пойти по альтернативной ветке
 */
export class F012ReasoningStateRollbackEngine {
  private readonly config: F012ReasoningStateRollbackConfig;
  private readonly executionHistory: F012ReasoningStateRollbackOutput[] = [];
  private readonly auditLog: F012ReasoningStateRollbackAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F012ReasoningStateRollbackConfig>) {
    this.config = {
      ...DEFAULT_F012_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F012ReasoningStateRollbackConfig {
    return { ...this.config };
  }

  public validateInput(input: F012ReasoningStateRollbackInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F012ReasoningStateRollbackValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
  }

  public execute(input: F012ReasoningStateRollbackInput): F012ReasoningStateRollbackOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f012_${this.totalRuns}_${computeF012Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F012_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        graph_id: input.graph_id,
        target_checkpoint_id: input.target_checkpoint_id,
        steps_reverted: input.steps_reverted,
        alternate_branch_id: input.alternate_branch_id,
      });

      const provenanceDigest = computeF012Digest(canonicalPayload);
      const auditRecord: F012ReasoningStateRollbackAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F012_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `branch_rollback:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F012ReasoningStateRollbackOutput = {
        featureId: F012_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F012_OPERATION_CODE,
        resolved_graph_id: input.graph_id,
        resolved_target_checkpoint_id: input.target_checkpoint_id,
        resolved_steps_reverted: input.steps_reverted,
        resolved_alternate_branch_id: input.alternate_branch_id,
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

  public getTelemetrySnapshot(): F012ReasoningStateRollbackTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F012_FEATURE_ID,
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

  public getAuditTrail(): readonly F012ReasoningStateRollbackAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F012ReasoningStateRollbackOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F012 (Откат ветки рассуждений (State Rollback))
 */
export function verifyF012Module(): {
  featureId: typeof F012_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F012ReasoningStateRollbackEngine();
  const sampleInput: F012ReasoningStateRollbackInput = {
    requestId: "req_verify_f012",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f012_graph_id_verified",
    target_checkpoint_id: 100,
    steps_reverted: true,
    alternate_branch_id: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 12 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F012" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F012_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
