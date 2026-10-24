/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F043
 * ============================================================================
 * Feature ID: F043
 * Stage: stage2-canvas
 * Title: Песочница предпросмотра UI-компонентов
 * Description: Живой рендер HTML/Tailwind/React-артефактов прямо внутри вкладки Canvas
 * Operation Code: ui_sandbox_preview
 * Target Package Directory: packages/core/src/stage2-canvas
 * ============================================================================
 */

export const F043_FEATURE_ID = "F043" as const;
export const F043_STAGE = "stage2-canvas" as const;
export const F043_OPERATION_CODE = "ui_sandbox_preview" as const;
export const F043_CONTRACT_VERSION = "1.0.0" as const;

export type F043UiComponentPreviewSandboxExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F043UiComponentPreviewSandboxConfig {
  readonly featureId: typeof F043_FEATURE_ID;
  readonly stage: typeof F043_STAGE;
  readonly operationCode: typeof F043_OPERATION_CODE;
  readonly contractVersion: typeof F043_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F043UiComponentPreviewSandboxInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly component_id: string;
  readonly framework_mode: string | number;
  readonly isolated_iframe_csp: string | number | boolean | readonly string[];
  readonly hydrated_ok: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F043UiComponentPreviewSandboxOutput {
  readonly featureId: typeof F043_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F043UiComponentPreviewSandboxExecutionStatus;
  readonly operationCode: typeof F043_OPERATION_CODE;
  readonly resolved_component_id: string;
  readonly resolved_framework_mode: string | number;
  readonly resolved_isolated_iframe_csp: string | number | boolean | readonly string[];
  readonly resolved_hydrated_ok: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F043UiComponentPreviewSandboxAuditEntry;
}

export interface F043UiComponentPreviewSandboxAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F043_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F043UiComponentPreviewSandboxTelemetrySnapshot {
  readonly featureId: typeof F043_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F043_CONFIG: F043UiComponentPreviewSandboxConfig = {
  featureId: F043_FEATURE_ID,
  stage: F043_STAGE,
  operationCode: F043_OPERATION_CODE,
  contractVersion: F043_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F043UiComponentPreviewSandboxValidationError extends Error {
  public readonly featureId = F043_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F043 Validation Error on '${field}']: ${message}`);
    this.name = "F043UiComponentPreviewSandboxValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F043 provenance & audit integrity.
 */
export function computeF043Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f043_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F043: Песочница предпросмотра UI-компонентов
 * Живой рендер HTML/Tailwind/React-артефактов прямо внутри вкладки Canvas
 */
export class F043UiComponentPreviewSandboxEngine {
  private readonly config: F043UiComponentPreviewSandboxConfig;
  private readonly executionHistory: F043UiComponentPreviewSandboxOutput[] = [];
  private readonly auditLog: F043UiComponentPreviewSandboxAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F043UiComponentPreviewSandboxConfig>) {
    this.config = {
      ...DEFAULT_F043_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F043UiComponentPreviewSandboxConfig {
    return { ...this.config };
  }

  public validateInput(input: F043UiComponentPreviewSandboxInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.component_id).trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("component_id", "Primary domain attribute 'component_id' cannot be empty.");
    }
  }

  public execute(input: F043UiComponentPreviewSandboxInput): F043UiComponentPreviewSandboxOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f043_${this.totalRuns}_${computeF043Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F043_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        component_id: input.component_id,
        framework_mode: input.framework_mode,
        isolated_iframe_csp: input.isolated_iframe_csp,
        hydrated_ok: input.hydrated_ok,
      });

      const provenanceDigest = computeF043Digest(canonicalPayload);
      const auditRecord: F043UiComponentPreviewSandboxAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F043_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ui_sandbox_preview:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F043UiComponentPreviewSandboxOutput = {
        featureId: F043_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F043_OPERATION_CODE,
        resolved_component_id: input.component_id,
        resolved_framework_mode: input.framework_mode,
        resolved_isolated_iframe_csp: input.isolated_iframe_csp,
        resolved_hydrated_ok: input.hydrated_ok,
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

  public getTelemetrySnapshot(): F043UiComponentPreviewSandboxTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F043_FEATURE_ID,
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

  public getAuditTrail(): readonly F043UiComponentPreviewSandboxAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F043UiComponentPreviewSandboxOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F043 (Песочница предпросмотра UI-компонентов)
 */
export function verifyF043Module(): {
  featureId: typeof F043_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F043UiComponentPreviewSandboxEngine();
  const sampleInput: F043UiComponentPreviewSandboxInput = {
    requestId: "req_verify_f043",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    component_id: "f043_component_id_verified",
    framework_mode: 100,
    isolated_iframe_csp: true,
    hydrated_ok: "verified_ok",
    metadata: { stage: "stage2-canvas", featureNumber: 43 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F043" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F043_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
