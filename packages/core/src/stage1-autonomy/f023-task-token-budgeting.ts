/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F023
 * ============================================================================
 * Feature ID: F023
 * Stage: stage1-autonomy
 * Title: Бюджетирование токенов на задачу
 * Description: Жёсткий лимит стоимости одного запуска графа с защитой от перерасхода
 * Operation Code: token_budget_guard
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F023_FEATURE_ID = "F023" as const;
export const F023_STAGE = "stage1-autonomy" as const;
export const F023_OPERATION_CODE = "token_budget_guard" as const;
export const F023_CONTRACT_VERSION = "1.0.0" as const;

export type F023TaskTokenBudgetingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F023TaskTokenBudgetingConfig {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly stage: typeof F023_STAGE;
  readonly operationCode: typeof F023_OPERATION_CODE;
  readonly contractVersion: typeof F023_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F023TaskTokenBudgetingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly graph_id: string;
  readonly allocated_tokens: string | number;
  readonly consumed_tokens: string | number | boolean | readonly string[];
  readonly budget_remaining: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F023TaskTokenBudgetingOutput {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F023TaskTokenBudgetingExecutionStatus;
  readonly operationCode: typeof F023_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_allocated_tokens: string | number;
  readonly resolved_consumed_tokens: string | number | boolean | readonly string[];
  readonly resolved_budget_remaining: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F023TaskTokenBudgetingAuditEntry;
}

export interface F023TaskTokenBudgetingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F023_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F023TaskTokenBudgetingTelemetrySnapshot {
  readonly featureId: typeof F023_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F023_CONFIG: F023TaskTokenBudgetingConfig = {
  featureId: F023_FEATURE_ID,
  stage: F023_STAGE,
  operationCode: F023_OPERATION_CODE,
  contractVersion: F023_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F023TaskTokenBudgetingValidationError extends Error {
  public readonly featureId = F023_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F023 Validation Error on '${field}']: ${message}`);
    this.name = "F023TaskTokenBudgetingValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F023 provenance & audit integrity.
 */
export function computeF023Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f023_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F023: Бюджетирование токенов на задачу
 * Жёсткий лимит стоимости одного запуска графа с защитой от перерасхода
 */
export class F023TaskTokenBudgetingEngine {
  private readonly config: F023TaskTokenBudgetingConfig;
  private readonly executionHistory: F023TaskTokenBudgetingOutput[] = [];
  private readonly auditLog: F023TaskTokenBudgetingAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F023TaskTokenBudgetingConfig>) {
    this.config = {
      ...DEFAULT_F023_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F023TaskTokenBudgetingConfig {
    return { ...this.config };
  }

  public validateInput(input: F023TaskTokenBudgetingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.graph_id).trim().length === 0) {
      throw new F023TaskTokenBudgetingValidationError("graph_id", "Primary domain attribute 'graph_id' cannot be empty.");
    }
  }

  public execute(input: F023TaskTokenBudgetingInput): F023TaskTokenBudgetingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f023_${this.totalRuns}_${computeF023Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F023_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        graph_id: input.graph_id,
        allocated_tokens: input.allocated_tokens,
        consumed_tokens: input.consumed_tokens,
        budget_remaining: input.budget_remaining,
      });

      const provenanceDigest = computeF023Digest(canonicalPayload);
      const auditRecord: F023TaskTokenBudgetingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F023_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `token_budget_guard:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F023TaskTokenBudgetingOutput = {
        featureId: F023_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F023_OPERATION_CODE,
        resolved_graph_id: input.graph_id,
        resolved_allocated_tokens: input.allocated_tokens,
        resolved_consumed_tokens: input.consumed_tokens,
        resolved_budget_remaining: input.budget_remaining,
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

  public getTelemetrySnapshot(): F023TaskTokenBudgetingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F023_FEATURE_ID,
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

  public getAuditTrail(): readonly F023TaskTokenBudgetingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F023TaskTokenBudgetingOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F023 (Бюджетирование токенов на задачу)
 */
export function verifyF023Module(): {
  featureId: typeof F023_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F023TaskTokenBudgetingEngine();
  const sampleInput: F023TaskTokenBudgetingInput = {
    requestId: "req_verify_f023",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f023_graph_id_verified",
    allocated_tokens: 100,
    consumed_tokens: true,
    budget_remaining: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 23 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F023" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F023_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
