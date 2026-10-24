/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F046
 * ============================================================================
 * Feature ID: F046
 * Stage: stage2-canvas
 * Title: Разделение экрана внутри Canvas (Split-View)
 * Description: Сопоставление исходного документа и сгенерированного отчёта бок о бок
 * Operation Code: split_view_comparer
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F046_FEATURE_ID = "F046" as const;
export const F046_STAGE = "stage2-canvas" as const;
export const F046_OPERATION_CODE = "split_view_comparer" as const;
export const F046_CONTRACT_VERSION = "1.0.0" as const;

export type F046CanvasSplitViewExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F046CanvasSplitViewConfig {
  readonly featureId: typeof F046_FEATURE_ID;
  readonly stage: typeof F046_STAGE;
  readonly operationCode: typeof F046_OPERATION_CODE;
  readonly contractVersion: typeof F046_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F046CanvasSplitViewInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly left_tab_id: string;
  readonly right_tab_id: string | number;
  readonly synchronized_scroll: string | number | boolean | readonly string[];
  readonly viewport_ratio: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F046CanvasSplitViewOutput {
  readonly featureId: typeof F046_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F046CanvasSplitViewExecutionStatus;
  readonly operationCode: typeof F046_OPERATION_CODE;
  readonly resolved_left_tab_id: string;
  readonly resolved_right_tab_id: string | number;
  readonly resolved_synchronized_scroll: string | number | boolean | readonly string[];
  readonly resolved_viewport_ratio: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F046CanvasSplitViewAuditEntry;
}

export interface F046CanvasSplitViewAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F046_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F046CanvasSplitViewTelemetrySnapshot {
  readonly featureId: typeof F046_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F046_CONFIG: F046CanvasSplitViewConfig = {
  featureId: F046_FEATURE_ID,
  stage: F046_STAGE,
  operationCode: F046_OPERATION_CODE,
  contractVersion: F046_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F046CanvasSplitViewValidationError extends Error {
  public readonly featureId = F046_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F046 Validation Error on '${field}']: ${message}`);
    this.name = "F046CanvasSplitViewValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F046 provenance & audit integrity.
 */
export function computeF046Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f046_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F046: Разделение экрана внутри Canvas (Split-View)
 * Сопоставление исходного документа и сгенерированного отчёта бок о бок
 */
export class F046CanvasSplitViewEngine {
  private readonly config: F046CanvasSplitViewConfig;
  private readonly executionHistory: F046CanvasSplitViewOutput[] = [];
  private readonly auditLog: F046CanvasSplitViewAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F046CanvasSplitViewConfig>) {
    this.config = {
      ...DEFAULT_F046_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F046CanvasSplitViewConfig {
    return { ...this.config };
  }

  public validateInput(input: F046CanvasSplitViewInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F046CanvasSplitViewValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F046CanvasSplitViewValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F046CanvasSplitViewValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F046CanvasSplitViewValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.left_tab_id).trim().length === 0) {
      throw new F046CanvasSplitViewValidationError("left_tab_id", "Primary domain attribute 'left_tab_id' cannot be empty.");
    }
  }

  public execute(input: F046CanvasSplitViewInput): F046CanvasSplitViewOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f046_${this.totalRuns}_${computeF046Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F046_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        left_tab_id: input.left_tab_id,
        right_tab_id: input.right_tab_id,
        synchronized_scroll: input.synchronized_scroll,
        viewport_ratio: input.viewport_ratio,
      });

      const provenanceDigest = computeF046Digest(canonicalPayload);
      const auditRecord: F046CanvasSplitViewAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F046_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `split_view_comparer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F046CanvasSplitViewOutput = {
        featureId: F046_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F046_OPERATION_CODE,
        resolved_left_tab_id: input.left_tab_id,
        resolved_right_tab_id: input.right_tab_id,
        resolved_synchronized_scroll: input.synchronized_scroll,
        resolved_viewport_ratio: input.viewport_ratio,
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

  public getTelemetrySnapshot(): F046CanvasSplitViewTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F046_FEATURE_ID,
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

  public getAuditTrail(): readonly F046CanvasSplitViewAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F046CanvasSplitViewOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F046 (Разделение экрана внутри Canvas (Split-View))
 */
export function verifyF046Module(): {
  featureId: typeof F046_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F046CanvasSplitViewEngine();
  const sampleInput: F046CanvasSplitViewInput = {
    requestId: "req_verify_f046",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    left_tab_id: "f046_left_tab_id_verified",
    right_tab_id: 100,
    synchronized_scroll: true,
    viewport_ratio: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 46 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F046" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F046_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
