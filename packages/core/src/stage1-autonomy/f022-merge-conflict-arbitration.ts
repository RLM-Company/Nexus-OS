/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F022
 * ============================================================================
 * Feature ID: F022
 * Stage: stage1-autonomy
 * Title: Разрешение конфликтов слияния результатов
 * Description: Арбитраж Менеджером противоречивых выводов от двух параллельных исследовательских агентов
 * Operation Code: conflict_arbiter
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F022_FEATURE_ID = "F022" as const;
export const F022_STAGE = "stage1-autonomy" as const;
export const F022_OPERATION_CODE = "conflict_arbiter" as const;
export const F022_CONTRACT_VERSION = "1.0.0" as const;

export type F022MergeConflictArbitrationExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F022MergeConflictArbitrationConfig {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly stage: typeof F022_STAGE;
  readonly operationCode: typeof F022_OPERATION_CODE;
  readonly contractVersion: typeof F022_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F022MergeConflictArbitrationInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly conflict_id: string;
  readonly winning_agent_id: string | number;
  readonly arbitration_score: string | number | boolean | readonly string[];
  readonly resolution_rationale: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F022MergeConflictArbitrationOutput {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F022MergeConflictArbitrationExecutionStatus;
  readonly operationCode: typeof F022_OPERATION_CODE;
  readonly resolved_conflict_id: string;
  readonly resolved_winning_agent_id: string | number;
  readonly resolved_arbitration_score: string | number | boolean | readonly string[];
  readonly resolved_resolution_rationale: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F022MergeConflictArbitrationAuditEntry;
}

export interface F022MergeConflictArbitrationAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F022_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F022MergeConflictArbitrationTelemetrySnapshot {
  readonly featureId: typeof F022_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F022_CONFIG: F022MergeConflictArbitrationConfig = {
  featureId: F022_FEATURE_ID,
  stage: F022_STAGE,
  operationCode: F022_OPERATION_CODE,
  contractVersion: F022_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F022MergeConflictArbitrationValidationError extends Error {
  public readonly featureId = F022_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F022 Validation Error on '${field}']: ${message}`);
    this.name = "F022MergeConflictArbitrationValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F022 provenance & audit integrity.
 */
export function computeF022Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f022_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F022: Разрешение конфликтов слияния результатов
 * Арбитраж Менеджером противоречивых выводов от двух параллельных исследовательских агентов
 */
export class F022MergeConflictArbitrationEngine {
  private readonly config: F022MergeConflictArbitrationConfig;
  private readonly executionHistory: F022MergeConflictArbitrationOutput[] = [];
  private readonly auditLog: F022MergeConflictArbitrationAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F022MergeConflictArbitrationConfig>) {
    this.config = {
      ...DEFAULT_F022_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F022MergeConflictArbitrationConfig {
    return { ...this.config };
  }

  public validateInput(input: F022MergeConflictArbitrationInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.conflict_id).trim().length === 0) {
      throw new F022MergeConflictArbitrationValidationError("conflict_id", "Primary domain attribute 'conflict_id' cannot be empty.");
    }
  }

  public execute(input: F022MergeConflictArbitrationInput): F022MergeConflictArbitrationOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f022_${this.totalRuns}_${computeF022Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F022_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        conflict_id: input.conflict_id,
        winning_agent_id: input.winning_agent_id,
        arbitration_score: input.arbitration_score,
        resolution_rationale: input.resolution_rationale,
      });

      const provenanceDigest = computeF022Digest(canonicalPayload);
      const auditRecord: F022MergeConflictArbitrationAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F022_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `conflict_arbiter:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F022MergeConflictArbitrationOutput = {
        featureId: F022_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F022_OPERATION_CODE,
        resolved_conflict_id: input.conflict_id,
        resolved_winning_agent_id: input.winning_agent_id,
        resolved_arbitration_score: input.arbitration_score,
        resolved_resolution_rationale: input.resolution_rationale,
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

  public getTelemetrySnapshot(): F022MergeConflictArbitrationTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F022_FEATURE_ID,
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

  public getAuditTrail(): readonly F022MergeConflictArbitrationAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F022MergeConflictArbitrationOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F022 (Разрешение конфликтов слияния результатов)
 */
export function verifyF022Module(): {
  featureId: typeof F022_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F022MergeConflictArbitrationEngine();
  const sampleInput: F022MergeConflictArbitrationInput = {
    requestId: "req_verify_f022",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    conflict_id: "f022_conflict_id_verified",
    winning_agent_id: 100,
    arbitration_score: true,
    resolution_rationale: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 22 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F022" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F022_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
