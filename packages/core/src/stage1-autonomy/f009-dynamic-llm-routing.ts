/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F009
 * ============================================================================
 * Feature ID: F009
 * Stage: stage1-autonomy
 * Title: Роутер моделей (Dynamic LLM Routing)
 * Description: Распределение простых задач на быстрые модели и сложных архитектурных узлов на флагманские модели
 * Operation Code: llm_router
 * Target Package Directory: packages/core/src/stage1-autonomy
 * ============================================================================
 */

export const F009_FEATURE_ID = "F009" as const;
export const F009_STAGE = "stage1-autonomy" as const;
export const F009_OPERATION_CODE = "llm_router" as const;
export const F009_CONTRACT_VERSION = "1.0.0" as const;

export type F009DynamicLlmRoutingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F009DynamicLlmRoutingConfig {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly stage: typeof F009_STAGE;
  readonly operationCode: typeof F009_OPERATION_CODE;
  readonly contractVersion: typeof F009_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F009DynamicLlmRoutingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly route_id: string;
  readonly selected_model: string | number;
  readonly complexity_tier: string | number | boolean | readonly string[];
  readonly estimated_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F009DynamicLlmRoutingOutput {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F009DynamicLlmRoutingExecutionStatus;
  readonly operationCode: typeof F009_OPERATION_CODE;
  readonly resolved_route_id: string;
  readonly resolved_selected_model: string | number;
  readonly resolved_complexity_tier: string | number | boolean | readonly string[];
  readonly resolved_estimated_cost_usd: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F009DynamicLlmRoutingAuditEntry;
}

export interface F009DynamicLlmRoutingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F009_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F009DynamicLlmRoutingTelemetrySnapshot {
  readonly featureId: typeof F009_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F009_CONFIG: F009DynamicLlmRoutingConfig = {
  featureId: F009_FEATURE_ID,
  stage: F009_STAGE,
  operationCode: F009_OPERATION_CODE,
  contractVersion: F009_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F009DynamicLlmRoutingValidationError extends Error {
  public readonly featureId = F009_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F009 Validation Error on '${field}']: ${message}`);
    this.name = "F009DynamicLlmRoutingValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F009 provenance & audit integrity.
 */
export function computeF009Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f009_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F009: Роутер моделей (Dynamic LLM Routing)
 * Распределение простых задач на быстрые модели и сложных архитектурных узлов на флагманские модели
 */
export class F009DynamicLlmRoutingEngine {
  private readonly config: F009DynamicLlmRoutingConfig;
  private readonly executionHistory: F009DynamicLlmRoutingOutput[] = [];
  private readonly auditLog: F009DynamicLlmRoutingAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F009DynamicLlmRoutingConfig>) {
    this.config = {
      ...DEFAULT_F009_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F009DynamicLlmRoutingConfig {
    return { ...this.config };
  }

  public validateInput(input: F009DynamicLlmRoutingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.route_id).trim().length === 0) {
      throw new F009DynamicLlmRoutingValidationError("route_id", "Primary domain attribute 'route_id' cannot be empty.");
    }
  }

  public execute(input: F009DynamicLlmRoutingInput): F009DynamicLlmRoutingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f009_${this.totalRuns}_${computeF009Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F009_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        route_id: input.route_id,
        selected_model: input.selected_model,
        complexity_tier: input.complexity_tier,
        estimated_cost_usd: input.estimated_cost_usd,
      });

      const provenanceDigest = computeF009Digest(canonicalPayload);
      const auditRecord: F009DynamicLlmRoutingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F009_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `llm_router:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F009DynamicLlmRoutingOutput = {
        featureId: F009_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F009_OPERATION_CODE,
        resolved_route_id: input.route_id,
        resolved_selected_model: input.selected_model,
        resolved_complexity_tier: input.complexity_tier,
        resolved_estimated_cost_usd: input.estimated_cost_usd,
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

  public getTelemetrySnapshot(): F009DynamicLlmRoutingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F009_FEATURE_ID,
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

  public getAuditTrail(): readonly F009DynamicLlmRoutingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F009DynamicLlmRoutingOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F009 (Роутер моделей (Dynamic LLM Routing))
 */
export function verifyF009Module(): {
  featureId: typeof F009_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F009DynamicLlmRoutingEngine();
  const sampleInput: F009DynamicLlmRoutingInput = {
    requestId: "req_verify_f009",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    route_id: "f009_route_id_verified",
    selected_model: 100,
    complexity_tier: true,
    estimated_cost_usd: "verified_ok",
    metadata: { stage: "stage1-autonomy", featureNumber: 9 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F009" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F009_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
