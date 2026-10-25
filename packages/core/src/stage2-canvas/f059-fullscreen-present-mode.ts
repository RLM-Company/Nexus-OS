/**
 * F059 (stage2-canvas): Режим чтения и презентации (Full-screen Present Mode)
 * Разворачивание слайдов на весь экран с поддержкой горячих клавиш
 * Operation Code: present_mode_controller
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F059_FEATURE_ID = "F059" as const;
export const F059_STAGE = "stage2-canvas" as const;
export const F059_OPERATION_CODE = "present_mode_controller" as const;
export const F059_CONTRACT_VERSION = "2.0.0" as const;

export type F059FullscreenPresentModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F059FullscreenPresentModeConfig {
  readonly featureId: typeof F059_FEATURE_ID;
  readonly stage: typeof F059_STAGE;
  readonly operationCode: typeof F059_OPERATION_CODE;
  readonly contractVersion: typeof F059_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F059FullscreenPresentModeInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly deck_id: string;
  readonly current_slide_index: string | number;
  readonly hotkeys_enabled: string | number | boolean | readonly string[];
  readonly fullscreen_active: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F059FullscreenPresentModeAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F059_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F059FullscreenPresentModeOutput {
  readonly featureId: typeof F059_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F059FullscreenPresentModeExecutionStatus;
  readonly operationCode: typeof F059_OPERATION_CODE;
  readonly resolved_deck_id: string;
  readonly resolved_current_slide_index: string | number;
  readonly resolved_hotkeys_enabled: string | number | boolean | readonly string[];
  readonly resolved_fullscreen_active: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F059FullscreenPresentModeAuditEntry;
}

export interface F059FullscreenPresentModeTelemetrySnapshot {
  readonly featureId: typeof F059_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F059_CONFIG: F059FullscreenPresentModeConfig = {
  featureId: F059_FEATURE_ID,
  stage: F059_STAGE,
  operationCode: F059_OPERATION_CODE,
  contractVersion: F059_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F059FullscreenPresentModeValidationError extends Error {
  public readonly featureId = F059_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F059 Validation Error on '${field}']: ${message}`);
    this.name = "F059FullscreenPresentModeValidationError";
    this.field = field;
  }
}

export function computeF059Digest(rawPayload: string): string {
  return `f059_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F059FullscreenPresentModeEngine {
  private readonly config: F059FullscreenPresentModeConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F059FullscreenPresentModeOutput[] = [];
  private readonly auditLog: F059FullscreenPresentModeAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F059FullscreenPresentModeOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F059FullscreenPresentModeConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F059_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F059FullscreenPresentModeConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F059FullscreenPresentModeInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F059FullscreenPresentModeValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F059FullscreenPresentModeValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F059FullscreenPresentModeValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F059FullscreenPresentModeValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F059FullscreenPresentModeValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F059FullscreenPresentModeValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.deck_id).trim().length === 0) {
      throw new F059FullscreenPresentModeValidationError("deck_id", "Primary domain attribute 'deck_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      deck_id: input.deck_id,
      current_slide_index: input.current_slide_index,
      hotkeys_enabled: input.hotkeys_enabled,
      fullscreen_active: input.fullscreen_active
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F059FullscreenPresentModeValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F059FullscreenPresentModeInput): F059FullscreenPresentModeOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F059_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        deck_id: input.deck_id,
        current_slide_index: input.current_slide_index,
        hotkeys_enabled: input.hotkeys_enabled,
        fullscreen_active: input.fullscreen_active
      });
      const payloadHash = computeF059Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F059FullscreenPresentModeValidationError(
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
        featureId: F059_FEATURE_ID,
        operationCode: F059_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          deck_id: input.deck_id,
          current_slide_index: input.current_slide_index,
          hotkeys_enabled: input.hotkeys_enabled,
          fullscreen_active: input.fullscreen_active
        }
      });

      const executionId = `exec_f059_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f059_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F059FullscreenPresentModeAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F059_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `present_mode_controller:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F059FullscreenPresentModeOutput = {
        featureId: F059_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F059_OPERATION_CODE,
        resolved_deck_id: kernelResult.resolvedFields.deck_id as string,
        resolved_current_slide_index: kernelResult.resolvedFields.current_slide_index as string | number,
        resolved_hotkeys_enabled: kernelResult.resolvedFields.hotkeys_enabled as string | number | boolean | readonly string[],
        resolved_fullscreen_active: kernelResult.resolvedFields.fullscreen_active as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F059FullscreenPresentModeTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F059_FEATURE_ID,
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

  public getAuditTrail(): readonly F059FullscreenPresentModeAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F059FullscreenPresentModeOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF059Module(): {
  featureId: typeof F059_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F059FullscreenPresentModeEngine();
  const sampleInput: F059FullscreenPresentModeInput = {
    requestId: "req_verify_f059",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    deck_id: "f059_deck_id_seed",
    current_slide_index: 42,
    hotkeys_enabled: true,
    fullscreen_active: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 59 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F059" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_deck_id !== sampleInput.deck_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F059_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
