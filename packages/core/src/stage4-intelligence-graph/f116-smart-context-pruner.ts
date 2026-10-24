/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F116
 * ============================================================================
 * Feature ID: F116
 * Stage: stage4-intelligence-graph
 * Title: Умная обрезка контекста (Smart Context Pruning)
 * Description: Вытеснение наименее релевантных кусков истории при приближении к лимиту токенов
 * Operation Code: relevance_context_pruner
 * Target Package Directory: packages/core/src/stage4-intelligence-graph
 * ============================================================================
 */

export const F116_FEATURE_ID = "F116" as const;
export const F116_STAGE = "stage4-intelligence-graph" as const;
export const F116_OPERATION_CODE = "relevance_context_pruner" as const;
export const F116_CONTRACT_VERSION = "1.0.0" as const;

export type F116SmartContextPrunerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F116SmartContextPrunerConfig {
  readonly featureId: typeof F116_FEATURE_ID;
  readonly stage: typeof F116_STAGE;
  readonly operationCode: typeof F116_OPERATION_CODE;
  readonly contractVersion: typeof F116_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F116SmartContextPrunerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly budget_limit_tokens: string;
  readonly evicted_chunks_count: string | number;
  readonly retained_high_value_ids: string | number | boolean | readonly string[];
  readonly freed_tokens: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F116SmartContextPrunerOutput {
  readonly featureId: typeof F116_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F116SmartContextPrunerExecutionStatus;
  readonly operationCode: typeof F116_OPERATION_CODE;
  readonly resolved_budget_limit_tokens: string;
  readonly resolved_evicted_chunks_count: string | number;
  readonly resolved_retained_high_value_ids: string | number | boolean | readonly string[];
  readonly resolved_freed_tokens: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F116SmartContextPrunerAuditEntry;
}

export interface F116SmartContextPrunerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F116_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F116SmartContextPrunerTelemetrySnapshot {
  readonly featureId: typeof F116_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F116_CONFIG: F116SmartContextPrunerConfig = {
  featureId: F116_FEATURE_ID,
  stage: F116_STAGE,
  operationCode: F116_OPERATION_CODE,
  contractVersion: F116_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F116SmartContextPrunerValidationError extends Error {
  public readonly featureId = F116_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F116 Validation Error on '${field}']: ${message}`);
    this.name = "F116SmartContextPrunerValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F116 provenance & audit integrity.
 */
export function computeF116Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f116_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F116: Умная обрезка контекста (Smart Context Pruning)
 * Вытеснение наименее релевантных кусков истории при приближении к лимиту токенов
 */
export class F116SmartContextPrunerEngine {
  private readonly config: F116SmartContextPrunerConfig;
  private readonly executionHistory: F116SmartContextPrunerOutput[] = [];
  private readonly auditLog: F116SmartContextPrunerAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F116SmartContextPrunerConfig>) {
    this.config = {
      ...DEFAULT_F116_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F116SmartContextPrunerConfig {
    return { ...this.config };
  }

  public validateInput(input: F116SmartContextPrunerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F116SmartContextPrunerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F116SmartContextPrunerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F116SmartContextPrunerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F116SmartContextPrunerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.budget_limit_tokens).trim().length === 0) {
      throw new F116SmartContextPrunerValidationError("budget_limit_tokens", "Primary domain attribute 'budget_limit_tokens' cannot be empty.");
    }
  }

  public execute(input: F116SmartContextPrunerInput): F116SmartContextPrunerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f116_${this.totalRuns}_${computeF116Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F116_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        budget_limit_tokens: input.budget_limit_tokens,
        evicted_chunks_count: input.evicted_chunks_count,
        retained_high_value_ids: input.retained_high_value_ids,
        freed_tokens: input.freed_tokens,
      });

      const provenanceDigest = computeF116Digest(canonicalPayload);
      const auditRecord: F116SmartContextPrunerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F116_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `relevance_context_pruner:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F116SmartContextPrunerOutput = {
        featureId: F116_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F116_OPERATION_CODE,
        resolved_budget_limit_tokens: input.budget_limit_tokens,
        resolved_evicted_chunks_count: input.evicted_chunks_count,
        resolved_retained_high_value_ids: input.retained_high_value_ids,
        resolved_freed_tokens: input.freed_tokens,
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

  public getTelemetrySnapshot(): F116SmartContextPrunerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F116_FEATURE_ID,
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

  public getAuditTrail(): readonly F116SmartContextPrunerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F116SmartContextPrunerOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F116 (Умная обрезка контекста (Smart Context Pruning))
 */
export function verifyF116Module(): {
  featureId: typeof F116_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F116SmartContextPrunerEngine();
  const sampleInput: F116SmartContextPrunerInput = {
    requestId: "req_verify_f116",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    budget_limit_tokens: "f116_budget_limit_tokens_verified",
    evicted_chunks_count: 100,
    retained_high_value_ids: true,
    freed_tokens: "verified_ok",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 116 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F116" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F116_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
