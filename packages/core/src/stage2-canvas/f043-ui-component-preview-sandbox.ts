/**
 * F043 (stage2-canvas): Песочница предпросмотра UI-компонентов
 * Живой рендер HTML/Tailwind/React-артефактов прямо внутри вкладки Canvas
 * Operation Code: ui_sandbox_preview
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F043_FEATURE_ID = "F043" as const;
export const F043_STAGE = "stage2-canvas" as const;
export const F043_OPERATION_CODE = "ui_sandbox_preview" as const;
export const F043_CONTRACT_VERSION = "2.0.0" as const;

export type F043UiComponentPreviewSandboxExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
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
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F043UiComponentPreviewSandboxAuditEntry;
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
  strictValidation: true
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

export function computeF043Digest(rawPayload: string): string {
  return `f043_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F043UiComponentPreviewSandboxEngine {
  private readonly config: F043UiComponentPreviewSandboxConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F043UiComponentPreviewSandboxOutput[] = [];
  private readonly auditLog: F043UiComponentPreviewSandboxAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F043UiComponentPreviewSandboxOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F043UiComponentPreviewSandboxConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F043_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F043UiComponentPreviewSandboxConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
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
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F043UiComponentPreviewSandboxValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.component_id).trim().length === 0) {
      throw new F043UiComponentPreviewSandboxValidationError("component_id", "Primary domain attribute 'component_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      component_id: input.component_id,
      framework_mode: input.framework_mode,
      isolated_iframe_csp: input.isolated_iframe_csp,
      hydrated_ok: input.hydrated_ok
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F043UiComponentPreviewSandboxValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F043UiComponentPreviewSandboxInput): F043UiComponentPreviewSandboxOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F043_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        component_id: input.component_id,
        framework_mode: input.framework_mode,
        isolated_iframe_csp: input.isolated_iframe_csp,
        hydrated_ok: input.hydrated_ok
      });
      const payloadHash = computeF043Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F043UiComponentPreviewSandboxValidationError(
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
        featureId: F043_FEATURE_ID,
        operationCode: F043_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          component_id: input.component_id,
          framework_mode: input.framework_mode,
          isolated_iframe_csp: input.isolated_iframe_csp,
          hydrated_ok: input.hydrated_ok
        }
      });

      const executionId = `exec_f043_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f043_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F043UiComponentPreviewSandboxAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F043_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ui_sandbox_preview:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
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
        resolved_component_id: kernelResult.resolvedFields.component_id as string,
        resolved_framework_mode: kernelResult.resolvedFields.framework_mode as string | number,
        resolved_isolated_iframe_csp: kernelResult.resolvedFields.isolated_iframe_csp as string | number | boolean | readonly string[],
        resolved_hydrated_ok: kernelResult.resolvedFields.hydrated_ok as string | number | boolean | Record<string, unknown>,
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
          : 0
    };
  }

  public getAuditTrail(): readonly F043UiComponentPreviewSandboxAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F043UiComponentPreviewSandboxOutput[] {
    return [...this.executionHistory];
  }
}

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
    component_id: "f043_component_id_seed",
    framework_mode: 42,
    isolated_iframe_csp: true,
    hydrated_ok: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 43 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F043" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_component_id !== sampleInput.component_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F043_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
