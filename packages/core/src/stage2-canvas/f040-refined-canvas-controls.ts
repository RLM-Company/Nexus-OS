/**
 * F040 (stage2-canvas): Уточняющие контролы холста (Refined Canvas Controls)
 * Быстрые кнопки над выделенным фрагментом: Сжать, Академический стиль, Проверить факты, В таблицу
 * Operation Code: floating_toolbar_action
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F040_FEATURE_ID = "F040" as const;
export const F040_STAGE = "stage2-canvas" as const;
export const F040_OPERATION_CODE = "floating_toolbar_action" as const;
export const F040_CONTRACT_VERSION = "2.0.0" as const;

export type F040RefinedCanvasControlsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F040RefinedCanvasControlsConfig {
  readonly featureId: typeof F040_FEATURE_ID;
  readonly stage: typeof F040_STAGE;
  readonly operationCode: typeof F040_OPERATION_CODE;
  readonly contractVersion: typeof F040_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F040RefinedCanvasControlsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly selection_id: string;
  readonly control_action: string | number;
  readonly original_length: string | number | boolean | readonly string[];
  readonly transformed_output: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F040RefinedCanvasControlsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F040_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F040RefinedCanvasControlsOutput {
  readonly featureId: typeof F040_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F040RefinedCanvasControlsExecutionStatus;
  readonly operationCode: typeof F040_OPERATION_CODE;
  readonly resolved_selection_id: string;
  readonly resolved_control_action: string | number;
  readonly resolved_original_length: string | number | boolean | readonly string[];
  readonly resolved_transformed_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F040RefinedCanvasControlsAuditEntry;
}

export interface F040RefinedCanvasControlsTelemetrySnapshot {
  readonly featureId: typeof F040_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F040_CONFIG: F040RefinedCanvasControlsConfig = {
  featureId: F040_FEATURE_ID,
  stage: F040_STAGE,
  operationCode: F040_OPERATION_CODE,
  contractVersion: F040_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F040RefinedCanvasControlsValidationError extends Error {
  public readonly featureId = F040_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F040 Validation Error on '${field}']: ${message}`);
    this.name = "F040RefinedCanvasControlsValidationError";
    this.field = field;
  }
}

export function computeF040Digest(rawPayload: string): string {
  return `f040_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F040RefinedCanvasControlsEngine {
  private readonly config: F040RefinedCanvasControlsConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F040RefinedCanvasControlsOutput[] = [];
  private readonly auditLog: F040RefinedCanvasControlsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F040RefinedCanvasControlsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F040RefinedCanvasControlsConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F040_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F040RefinedCanvasControlsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F040RefinedCanvasControlsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F040RefinedCanvasControlsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F040RefinedCanvasControlsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F040RefinedCanvasControlsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F040RefinedCanvasControlsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F040RefinedCanvasControlsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F040RefinedCanvasControlsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.selection_id).trim().length === 0) {
      throw new F040RefinedCanvasControlsValidationError("selection_id", "Primary domain attribute 'selection_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      selection_id: input.selection_id,
      control_action: input.control_action,
      original_length: input.original_length,
      transformed_output: input.transformed_output
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F040RefinedCanvasControlsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F040RefinedCanvasControlsInput): F040RefinedCanvasControlsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F040_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        selection_id: input.selection_id,
        control_action: input.control_action,
        original_length: input.original_length,
        transformed_output: input.transformed_output
      });
      const payloadHash = computeF040Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F040RefinedCanvasControlsValidationError(
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
        featureId: F040_FEATURE_ID,
        operationCode: F040_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          selection_id: input.selection_id,
          control_action: input.control_action,
          original_length: input.original_length,
          transformed_output: input.transformed_output
        }
      });

      const executionId = `exec_f040_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f040_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F040RefinedCanvasControlsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F040_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `floating_toolbar_action:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F040RefinedCanvasControlsOutput = {
        featureId: F040_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F040_OPERATION_CODE,
        resolved_selection_id: kernelResult.resolvedFields.selection_id as string,
        resolved_control_action: kernelResult.resolvedFields.control_action as string | number,
        resolved_original_length: kernelResult.resolvedFields.original_length as string | number | boolean | readonly string[],
        resolved_transformed_output: kernelResult.resolvedFields.transformed_output as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F040RefinedCanvasControlsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F040_FEATURE_ID,
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

  public getAuditTrail(): readonly F040RefinedCanvasControlsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F040RefinedCanvasControlsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF040Module(): {
  featureId: typeof F040_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F040RefinedCanvasControlsEngine();
  const sampleInput: F040RefinedCanvasControlsInput = {
    requestId: "req_verify_f040",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    selection_id: "f040_selection_id_seed",
    control_action: 42,
    original_length: true,
    transformed_output: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 40 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F040" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_selection_id !== sampleInput.selection_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F040_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
