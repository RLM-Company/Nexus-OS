/**
 * F037 (stage2-canvas): Интерактивный редактор презентаций (Presentation Editor)
 * По-слайдовое создание, редактирование сетки, тезисов и заметок спикера прямо на Canvas
 * Operation Code: slide_deck_editor
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F037_FEATURE_ID = "F037" as const;
export const F037_STAGE = "stage2-canvas" as const;
export const F037_OPERATION_CODE = "slide_deck_editor" as const;
export const F037_CONTRACT_VERSION = "2.0.0" as const;

export type F037InteractivePresentationEditorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F037InteractivePresentationEditorConfig {
  readonly featureId: typeof F037_FEATURE_ID;
  readonly stage: typeof F037_STAGE;
  readonly operationCode: typeof F037_OPERATION_CODE;
  readonly contractVersion: typeof F037_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F037InteractivePresentationEditorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly deck_id: string;
  readonly slide_count: string | number;
  readonly grid_layout: string | number | boolean | readonly string[];
  readonly speaker_notes_attached: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F037InteractivePresentationEditorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F037_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F037InteractivePresentationEditorOutput {
  readonly featureId: typeof F037_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F037InteractivePresentationEditorExecutionStatus;
  readonly operationCode: typeof F037_OPERATION_CODE;
  readonly resolved_deck_id: string;
  readonly resolved_slide_count: string | number;
  readonly resolved_grid_layout: string | number | boolean | readonly string[];
  readonly resolved_speaker_notes_attached: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F037InteractivePresentationEditorAuditEntry;
}

export interface F037InteractivePresentationEditorTelemetrySnapshot {
  readonly featureId: typeof F037_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F037_CONFIG: F037InteractivePresentationEditorConfig = {
  featureId: F037_FEATURE_ID,
  stage: F037_STAGE,
  operationCode: F037_OPERATION_CODE,
  contractVersion: F037_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F037InteractivePresentationEditorValidationError extends Error {
  public readonly featureId = F037_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F037 Validation Error on '${field}']: ${message}`);
    this.name = "F037InteractivePresentationEditorValidationError";
    this.field = field;
  }
}

export function computeF037Digest(rawPayload: string): string {
  return `f037_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F037InteractivePresentationEditorEngine {
  private readonly config: F037InteractivePresentationEditorConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F037InteractivePresentationEditorOutput[] = [];
  private readonly auditLog: F037InteractivePresentationEditorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F037InteractivePresentationEditorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F037InteractivePresentationEditorConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F037_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F037InteractivePresentationEditorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F037InteractivePresentationEditorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F037InteractivePresentationEditorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F037InteractivePresentationEditorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F037InteractivePresentationEditorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F037InteractivePresentationEditorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F037InteractivePresentationEditorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F037InteractivePresentationEditorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.deck_id).trim().length === 0) {
      throw new F037InteractivePresentationEditorValidationError("deck_id", "Primary domain attribute 'deck_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      deck_id: input.deck_id,
      slide_count: input.slide_count,
      grid_layout: input.grid_layout,
      speaker_notes_attached: input.speaker_notes_attached
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F037InteractivePresentationEditorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F037InteractivePresentationEditorInput): F037InteractivePresentationEditorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F037_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        deck_id: input.deck_id,
        slide_count: input.slide_count,
        grid_layout: input.grid_layout,
        speaker_notes_attached: input.speaker_notes_attached
      });
      const payloadHash = computeF037Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F037InteractivePresentationEditorValidationError(
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
        featureId: F037_FEATURE_ID,
        operationCode: F037_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          deck_id: input.deck_id,
          slide_count: input.slide_count,
          grid_layout: input.grid_layout,
          speaker_notes_attached: input.speaker_notes_attached
        }
      });

      const executionId = `exec_f037_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f037_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F037InteractivePresentationEditorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F037_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `slide_deck_editor:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F037InteractivePresentationEditorOutput = {
        featureId: F037_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F037_OPERATION_CODE,
        resolved_deck_id: kernelResult.resolvedFields.deck_id as string,
        resolved_slide_count: kernelResult.resolvedFields.slide_count as string | number,
        resolved_grid_layout: kernelResult.resolvedFields.grid_layout as string | number | boolean | readonly string[],
        resolved_speaker_notes_attached: kernelResult.resolvedFields.speaker_notes_attached as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F037InteractivePresentationEditorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F037_FEATURE_ID,
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

  public getAuditTrail(): readonly F037InteractivePresentationEditorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F037InteractivePresentationEditorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF037Module(): {
  featureId: typeof F037_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F037InteractivePresentationEditorEngine();
  const sampleInput: F037InteractivePresentationEditorInput = {
    requestId: "req_verify_f037",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    deck_id: "f037_deck_id_seed",
    slide_count: 42,
    grid_layout: true,
    speaker_notes_attached: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 37 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F037" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_deck_id !== sampleInput.deck_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F037_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
