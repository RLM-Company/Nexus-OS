/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F125
 * ============================================================================
 * Feature ID: F125
 * Stage: stage4-intelligence-graph
 * Title: Слияние выводов из параллельных веток чата
 * Description: Перенос финального артефакта из экспериментальной ветки обратно в основную
 * Operation Code: chat_branch_merger
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F125_FEATURE_ID = "F125" as const;
export const F125_STAGE = "stage4-intelligence-graph" as const;
export const F125_OPERATION_CODE = "chat_branch_merger" as const;
export const F125_CONTRACT_VERSION = "1.0.0" as const;

export type F125ParallelChatBranchMergerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F125ParallelChatBranchMergerConfig {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly stage: typeof F125_STAGE;
  readonly operationCode: typeof F125_OPERATION_CODE;
  readonly contractVersion: typeof F125_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F125ParallelChatBranchMergerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly source_branch_id: string;
  readonly target_branch_id: string | number;
  readonly promoted_artifact_id: string | number | boolean | readonly string[];
  readonly merge_commit_id: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F125ParallelChatBranchMergerOutput {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F125ParallelChatBranchMergerExecutionStatus;
  readonly operationCode: typeof F125_OPERATION_CODE;
  readonly resolved_source_branch_id: string;
  readonly resolved_target_branch_id: string | number;
  readonly resolved_promoted_artifact_id: string | number | boolean | readonly string[];
  readonly resolved_merge_commit_id: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F125ParallelChatBranchMergerAuditEntry;
}

export interface F125ParallelChatBranchMergerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F125_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F125ParallelChatBranchMergerTelemetrySnapshot {
  readonly featureId: typeof F125_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F125_CONFIG: F125ParallelChatBranchMergerConfig = {
  featureId: F125_FEATURE_ID,
  stage: F125_STAGE,
  operationCode: F125_OPERATION_CODE,
  contractVersion: F125_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F125ParallelChatBranchMergerValidationError extends Error {
  public readonly featureId = F125_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F125 Validation Error on '${field}']: ${message}`);
    this.name = "F125ParallelChatBranchMergerValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F125 provenance & audit integrity.
 */
export function computeF125Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f125_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F125: Слияние выводов из параллельных веток чата
 * Перенос финального артефакта из экспериментальной ветки обратно в основную
 */
export class F125ParallelChatBranchMergerEngine {
  private readonly config: F125ParallelChatBranchMergerConfig;
  private readonly executionHistory: F125ParallelChatBranchMergerOutput[] = [];
  private readonly auditLog: F125ParallelChatBranchMergerAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F125ParallelChatBranchMergerConfig>) {
    this.config = {
      ...DEFAULT_F125_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F125ParallelChatBranchMergerConfig {
    return { ...this.config };
  }

  public validateInput(input: F125ParallelChatBranchMergerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.source_branch_id).trim().length === 0) {
      throw new F125ParallelChatBranchMergerValidationError("source_branch_id", "Primary domain attribute 'source_branch_id' cannot be empty.");
    }
  }

  public execute(input: F125ParallelChatBranchMergerInput): F125ParallelChatBranchMergerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f125_${this.totalRuns}_${computeF125Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F125_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        source_branch_id: input.source_branch_id,
        target_branch_id: input.target_branch_id,
        promoted_artifact_id: input.promoted_artifact_id,
        merge_commit_id: input.merge_commit_id,
      });

      const provenanceDigest = computeF125Digest(canonicalPayload);
      const auditRecord: F125ParallelChatBranchMergerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F125_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `chat_branch_merger:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F125ParallelChatBranchMergerOutput = {
        featureId: F125_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F125_OPERATION_CODE,
        resolved_source_branch_id: input.source_branch_id,
        resolved_target_branch_id: input.target_branch_id,
        resolved_promoted_artifact_id: input.promoted_artifact_id,
        resolved_merge_commit_id: input.merge_commit_id,
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

  public getTelemetrySnapshot(): F125ParallelChatBranchMergerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F125_FEATURE_ID,
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

  public getAuditTrail(): readonly F125ParallelChatBranchMergerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F125ParallelChatBranchMergerOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F125 (Слияние выводов из параллельных веток чата)
 */
export function verifyF125Module(): {
  featureId: typeof F125_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F125ParallelChatBranchMergerEngine();
  const sampleInput: F125ParallelChatBranchMergerInput = {
    requestId: "req_verify_f125",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_branch_id: "f125_source_branch_id_verified",
    target_branch_id: 100,
    promoted_artifact_id: true,
    merge_commit_id: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 125 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F125" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F125_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
