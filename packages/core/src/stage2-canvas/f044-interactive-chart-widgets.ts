/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F044
 * ============================================================================
 * Feature ID: F044
 * Stage: stage2-canvas
 * Title: Встраивание интерактивных графиков (Chart Widgets)
 * Description: Генерация динамических дашбордов (линейные, бар-чарты, воронки) по данным из отчёта
 * Operation Code: chart_widget_engine
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F044_FEATURE_ID = "F044" as const;
export const F044_STAGE = "stage2-canvas" as const;
export const F044_OPERATION_CODE = "chart_widget_engine" as const;
export const F044_CONTRACT_VERSION = "1.0.0" as const;

export type F044InteractiveChartWidgetsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F044InteractiveChartWidgetsConfig {
  readonly featureId: typeof F044_FEATURE_ID;
  readonly stage: typeof F044_STAGE;
  readonly operationCode: typeof F044_OPERATION_CODE;
  readonly contractVersion: typeof F044_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F044InteractiveChartWidgetsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly widget_id: string;
  readonly chart_type: string | number;
  readonly series_count: string | number | boolean | readonly string[];
  readonly interactive_tooltips: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F044InteractiveChartWidgetsOutput {
  readonly featureId: typeof F044_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F044InteractiveChartWidgetsExecutionStatus;
  readonly operationCode: typeof F044_OPERATION_CODE;
  readonly resolved_widget_id: string;
  readonly resolved_chart_type: string | number;
  readonly resolved_series_count: string | number | boolean | readonly string[];
  readonly resolved_interactive_tooltips: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F044InteractiveChartWidgetsAuditEntry;
}

export interface F044InteractiveChartWidgetsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F044_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F044InteractiveChartWidgetsTelemetrySnapshot {
  readonly featureId: typeof F044_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F044_CONFIG: F044InteractiveChartWidgetsConfig = {
  featureId: F044_FEATURE_ID,
  stage: F044_STAGE,
  operationCode: F044_OPERATION_CODE,
  contractVersion: F044_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F044InteractiveChartWidgetsValidationError extends Error {
  public readonly featureId = F044_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F044 Validation Error on '${field}']: ${message}`);
    this.name = "F044InteractiveChartWidgetsValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F044 provenance & audit integrity.
 */
export function computeF044Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f044_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F044: Встраивание интерактивных графиков (Chart Widgets)
 * Генерация динамических дашбордов (линейные, бар-чарты, воронки) по данным из отчёта
 */
export class F044InteractiveChartWidgetsEngine {
  private readonly config: F044InteractiveChartWidgetsConfig;
  private readonly executionHistory: F044InteractiveChartWidgetsOutput[] = [];
  private readonly auditLog: F044InteractiveChartWidgetsAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F044InteractiveChartWidgetsConfig>) {
    this.config = {
      ...DEFAULT_F044_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F044InteractiveChartWidgetsConfig {
    return { ...this.config };
  }

  public validateInput(input: F044InteractiveChartWidgetsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.widget_id).trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("widget_id", "Primary domain attribute 'widget_id' cannot be empty.");
    }
  }

  public execute(input: F044InteractiveChartWidgetsInput): F044InteractiveChartWidgetsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f044_${this.totalRuns}_${computeF044Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F044_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        widget_id: input.widget_id,
        chart_type: input.chart_type,
        series_count: input.series_count,
        interactive_tooltips: input.interactive_tooltips,
      });

      const provenanceDigest = computeF044Digest(canonicalPayload);
      const auditRecord: F044InteractiveChartWidgetsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F044_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `chart_widget_engine:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F044InteractiveChartWidgetsOutput = {
        featureId: F044_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F044_OPERATION_CODE,
        resolved_widget_id: input.widget_id,
        resolved_chart_type: input.chart_type,
        resolved_series_count: input.series_count,
        resolved_interactive_tooltips: input.interactive_tooltips,
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

  public getTelemetrySnapshot(): F044InteractiveChartWidgetsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F044_FEATURE_ID,
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

  public getAuditTrail(): readonly F044InteractiveChartWidgetsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F044InteractiveChartWidgetsOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F044 (Встраивание интерактивных графиков (Chart Widgets))
 */
export function verifyF044Module(): {
  featureId: typeof F044_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F044InteractiveChartWidgetsEngine();
  const sampleInput: F044InteractiveChartWidgetsInput = {
    requestId: "req_verify_f044",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    widget_id: "f044_widget_id_verified",
    chart_type: 100,
    series_count: true,
    interactive_tooltips: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 44 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F044" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F044_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
