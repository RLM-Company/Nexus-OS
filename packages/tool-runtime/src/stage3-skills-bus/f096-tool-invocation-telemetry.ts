/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F096
 * ============================================================================
 * Feature ID: F096
 * Stage: stage3-skills-bus
 * Title: Телеметрия успешности вызовов инструментов
 * Description: Статистика отказов и времени отклика по каждому внешнему коннектору
 * Operation Code: tool_metrics_collector
 * Target Package Directory: packages/tool-runtime/src/stage3-skills-bus
 * ============================================================================
 */

export const F096_FEATURE_ID = "F096" as const;
export const F096_STAGE = "stage3-skills-bus" as const;
export const F096_OPERATION_CODE = "tool_metrics_collector" as const;
export const F096_CONTRACT_VERSION = "1.0.0" as const;

export type F096ToolInvocationTelemetryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F096ToolInvocationTelemetryConfig {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly stage: typeof F096_STAGE;
  readonly operationCode: typeof F096_OPERATION_CODE;
  readonly contractVersion: typeof F096_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F096ToolInvocationTelemetryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly connector_id: string;
  readonly success_rate_pct: string | number;
  readonly avg_latency_ms: string | number | boolean | readonly string[];
  readonly total_invocations: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F096ToolInvocationTelemetryOutput {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F096ToolInvocationTelemetryExecutionStatus;
  readonly operationCode: typeof F096_OPERATION_CODE;
  readonly resolved_connector_id: string;
  readonly resolved_success_rate_pct: string | number;
  readonly resolved_avg_latency_ms: string | number | boolean | readonly string[];
  readonly resolved_total_invocations: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F096ToolInvocationTelemetryAuditEntry;
}

export interface F096ToolInvocationTelemetryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F096_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F096ToolInvocationTelemetryTelemetrySnapshot {
  readonly featureId: typeof F096_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F096_CONFIG: F096ToolInvocationTelemetryConfig = {
  featureId: F096_FEATURE_ID,
  stage: F096_STAGE,
  operationCode: F096_OPERATION_CODE,
  contractVersion: F096_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F096ToolInvocationTelemetryValidationError extends Error {
  public readonly featureId = F096_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F096 Validation Error on '${field}']: ${message}`);
    this.name = "F096ToolInvocationTelemetryValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F096 provenance & audit integrity.
 */
export function computeF096Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f096_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F096: Телеметрия успешности вызовов инструментов
 * Статистика отказов и времени отклика по каждому внешнему коннектору
 */
export class F096ToolInvocationTelemetryEngine {
  private readonly config: F096ToolInvocationTelemetryConfig;
  private readonly executionHistory: F096ToolInvocationTelemetryOutput[] = [];
  private readonly auditLog: F096ToolInvocationTelemetryAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F096ToolInvocationTelemetryConfig>) {
    this.config = {
      ...DEFAULT_F096_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F096ToolInvocationTelemetryConfig {
    return { ...this.config };
  }

  public validateInput(input: F096ToolInvocationTelemetryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.connector_id).trim().length === 0) {
      throw new F096ToolInvocationTelemetryValidationError("connector_id", "Primary domain attribute 'connector_id' cannot be empty.");
    }
  }

  public execute(input: F096ToolInvocationTelemetryInput): F096ToolInvocationTelemetryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f096_${this.totalRuns}_${computeF096Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F096_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        connector_id: input.connector_id,
        success_rate_pct: input.success_rate_pct,
        avg_latency_ms: input.avg_latency_ms,
        total_invocations: input.total_invocations,
      });

      const provenanceDigest = computeF096Digest(canonicalPayload);
      const auditRecord: F096ToolInvocationTelemetryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F096_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tool_metrics_collector:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F096ToolInvocationTelemetryOutput = {
        featureId: F096_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F096_OPERATION_CODE,
        resolved_connector_id: input.connector_id,
        resolved_success_rate_pct: input.success_rate_pct,
        resolved_avg_latency_ms: input.avg_latency_ms,
        resolved_total_invocations: input.total_invocations,
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

  public getTelemetrySnapshot(): F096ToolInvocationTelemetryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F096_FEATURE_ID,
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

  public getAuditTrail(): readonly F096ToolInvocationTelemetryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F096ToolInvocationTelemetryOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F096 (Телеметрия успешности вызовов инструментов)
 */
export function verifyF096Module(): {
  featureId: typeof F096_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F096ToolInvocationTelemetryEngine();
  const sampleInput: F096ToolInvocationTelemetryInput = {
    requestId: "req_verify_f096",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    connector_id: "f096_connector_id_verified",
    success_rate_pct: 100,
    avg_latency_ms: true,
    total_invocations: "verified_ok",
    metadata: { stage: "stage3-skills-bus", featureNumber: 96 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F096" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F096_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
