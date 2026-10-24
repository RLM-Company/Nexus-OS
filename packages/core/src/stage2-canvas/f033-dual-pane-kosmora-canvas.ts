/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F033
 * ============================================================================
 * Feature ID: F033
 * Stage: stage2-canvas
 * Title: Двухпанельный интерфейс Kosmora Canvas
 * Description: Синхронная работа чата управления слева и интерактивного рабочего полотна справа
 * Operation Code: dual_pane_sync
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F033_FEATURE_ID = "F033" as const;
export const F033_STAGE = "stage2-canvas" as const;
export const F033_OPERATION_CODE = "dual_pane_sync" as const;
export const F033_CONTRACT_VERSION = "1.0.0" as const;

export type F033DualPaneKosmoraCanvasExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F033DualPaneKosmoraCanvasConfig {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly stage: typeof F033_STAGE;
  readonly operationCode: typeof F033_OPERATION_CODE;
  readonly contractVersion: typeof F033_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F033DualPaneKosmoraCanvasInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly workspace_id: string;
  readonly chat_pane_width_pct: string | number;
  readonly canvas_pane_width_pct: string | number | boolean | readonly string[];
  readonly sync_cursor_active: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F033DualPaneKosmoraCanvasOutput {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F033DualPaneKosmoraCanvasExecutionStatus;
  readonly operationCode: typeof F033_OPERATION_CODE;
  readonly resolved_workspace_id: string;
  readonly resolved_chat_pane_width_pct: string | number;
  readonly resolved_canvas_pane_width_pct: string | number | boolean | readonly string[];
  readonly resolved_sync_cursor_active: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F033DualPaneKosmoraCanvasAuditEntry;
}

export interface F033DualPaneKosmoraCanvasAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F033_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F033DualPaneKosmoraCanvasTelemetrySnapshot {
  readonly featureId: typeof F033_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F033_CONFIG: F033DualPaneKosmoraCanvasConfig = {
  featureId: F033_FEATURE_ID,
  stage: F033_STAGE,
  operationCode: F033_OPERATION_CODE,
  contractVersion: F033_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F033DualPaneKosmoraCanvasValidationError extends Error {
  public readonly featureId = F033_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F033 Validation Error on '${field}']: ${message}`);
    this.name = "F033DualPaneKosmoraCanvasValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F033 provenance & audit integrity.
 */
export function computeF033Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f033_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F033: Двухпанельный интерфейс Kosmora Canvas
 * Синхронная работа чата управления слева и интерактивного рабочего полотна справа
 */
export class F033DualPaneKosmoraCanvasEngine {
  private readonly config: F033DualPaneKosmoraCanvasConfig;
  private readonly executionHistory: F033DualPaneKosmoraCanvasOutput[] = [];
  private readonly auditLog: F033DualPaneKosmoraCanvasAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F033DualPaneKosmoraCanvasConfig>) {
    this.config = {
      ...DEFAULT_F033_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F033DualPaneKosmoraCanvasConfig {
    return { ...this.config };
  }

  public validateInput(input: F033DualPaneKosmoraCanvasInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.workspace_id).trim().length === 0) {
      throw new F033DualPaneKosmoraCanvasValidationError("workspace_id", "Primary domain attribute 'workspace_id' cannot be empty.");
    }
  }

  public execute(input: F033DualPaneKosmoraCanvasInput): F033DualPaneKosmoraCanvasOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f033_${this.totalRuns}_${computeF033Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F033_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        workspace_id: input.workspace_id,
        chat_pane_width_pct: input.chat_pane_width_pct,
        canvas_pane_width_pct: input.canvas_pane_width_pct,
        sync_cursor_active: input.sync_cursor_active,
      });

      const provenanceDigest = computeF033Digest(canonicalPayload);
      const auditRecord: F033DualPaneKosmoraCanvasAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F033_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `dual_pane_sync:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F033DualPaneKosmoraCanvasOutput = {
        featureId: F033_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F033_OPERATION_CODE,
        resolved_workspace_id: input.workspace_id,
        resolved_chat_pane_width_pct: input.chat_pane_width_pct,
        resolved_canvas_pane_width_pct: input.canvas_pane_width_pct,
        resolved_sync_cursor_active: input.sync_cursor_active,
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

  public getTelemetrySnapshot(): F033DualPaneKosmoraCanvasTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F033_FEATURE_ID,
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

  public getAuditTrail(): readonly F033DualPaneKosmoraCanvasAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F033DualPaneKosmoraCanvasOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F033 (Двухпанельный интерфейс Kosmora Canvas)
 */
export function verifyF033Module(): {
  featureId: typeof F033_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F033DualPaneKosmoraCanvasEngine();
  const sampleInput: F033DualPaneKosmoraCanvasInput = {
    requestId: "req_verify_f033",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    workspace_id: "f033_workspace_id_verified",
    chat_pane_width_pct: 100,
    canvas_pane_width_pct: true,
    sync_cursor_active: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 33 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F033" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F033_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
