/**
 * F044 (stage2-canvas): Встраивание интерактивных графиков (Chart Widgets)
 * Генерация динамических дашбордов (линейные, бар-чарты, воронки) по данным из отчёта
 * Operation Code: chart_widget_engine
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F044_FEATURE_ID = "F044" as const;
export const F044_STAGE = "stage2-canvas" as const;
export const F044_OPERATION_CODE = "chart_widget_engine" as const;
export const F044_CONTRACT_VERSION = "2.0.0" as const;

export type F044InteractiveChartWidgetsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
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
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F044InteractiveChartWidgetsAuditEntry;
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
  strictValidation: true
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

export function computeF044Digest(rawPayload: string): string {
  return `f044_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F044InteractiveChartWidgetsEngine {
  private readonly config: F044InteractiveChartWidgetsConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F044InteractiveChartWidgetsOutput[] = [];
  private readonly auditLog: F044InteractiveChartWidgetsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F044InteractiveChartWidgetsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F044InteractiveChartWidgetsConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F044_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F044InteractiveChartWidgetsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
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
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F044InteractiveChartWidgetsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.widget_id).trim().length === 0) {
      throw new F044InteractiveChartWidgetsValidationError("widget_id", "Primary domain attribute 'widget_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      widget_id: input.widget_id,
      chart_type: input.chart_type,
      series_count: input.series_count,
      interactive_tooltips: input.interactive_tooltips
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F044InteractiveChartWidgetsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F044InteractiveChartWidgetsInput): F044InteractiveChartWidgetsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F044_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        widget_id: input.widget_id,
        chart_type: input.chart_type,
        series_count: input.series_count,
        interactive_tooltips: input.interactive_tooltips
      });
      const payloadHash = computeF044Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F044InteractiveChartWidgetsValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F044_FEATURE_ID,
        operationCode: F044_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          widget_id: input.widget_id,
          chart_type: input.chart_type,
          series_count: input.series_count,
          interactive_tooltips: input.interactive_tooltips
        }
      });

      const executionId = `exec_f044_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f044_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F044InteractiveChartWidgetsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F044_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `chart_widget_engine:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
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
        resolved_widget_id: kernelResult.resolvedFields.widget_id as string,
        resolved_chart_type: kernelResult.resolvedFields.chart_type as string | number,
        resolved_series_count: kernelResult.resolvedFields.series_count as string | number | boolean | readonly string[],
        resolved_interactive_tooltips: kernelResult.resolvedFields.interactive_tooltips as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
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
          : 0
    };
  }

  public getAuditTrail(): readonly F044InteractiveChartWidgetsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F044InteractiveChartWidgetsOutput[] {
    return [...this.executionHistory];
  }
}

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
    widget_id: "f044_widget_id_seed",
    chart_type: 42,
    series_count: true,
    interactive_tooltips: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 44 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F044" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_widget_id !== sampleInput.widget_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F044_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
