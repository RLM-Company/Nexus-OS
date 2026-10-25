/**
 * F055 (stage2-canvas): Сквозные переменные в документах
 * Динамические плейсхолдеры, которые обновляются во всём тексте при смене цифры в таблице
 * Operation Code: reactive_variable_binder
 */

import { createHash } from "node:crypto";
import { Stage2CanvasKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F055_FEATURE_ID = "F055" as const;
export const F055_STAGE = "stage2-canvas" as const;
export const F055_OPERATION_CODE = "reactive_variable_binder" as const;
export const F055_CONTRACT_VERSION = "2.0.0" as const;

export type F055CrossDocumentDynamicVariablesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F055CrossDocumentDynamicVariablesConfig {
  readonly featureId: typeof F055_FEATURE_ID;
  readonly stage: typeof F055_STAGE;
  readonly operationCode: typeof F055_OPERATION_CODE;
  readonly contractVersion: typeof F055_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F055CrossDocumentDynamicVariablesInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly variable_key: string;
  readonly updated_value: string | number;
  readonly bound_locations_updated: string | number | boolean | readonly string[];
  readonly interpolated_text: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F055CrossDocumentDynamicVariablesAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F055_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F055CrossDocumentDynamicVariablesOutput {
  readonly featureId: typeof F055_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F055CrossDocumentDynamicVariablesExecutionStatus;
  readonly operationCode: typeof F055_OPERATION_CODE;
  readonly resolved_variable_key: string;
  readonly resolved_updated_value: string | number;
  readonly resolved_bound_locations_updated: string | number | boolean | readonly string[];
  readonly resolved_interpolated_text: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F055CrossDocumentDynamicVariablesAuditEntry;
}

export interface F055CrossDocumentDynamicVariablesTelemetrySnapshot {
  readonly featureId: typeof F055_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F055_CONFIG: F055CrossDocumentDynamicVariablesConfig = {
  featureId: F055_FEATURE_ID,
  stage: F055_STAGE,
  operationCode: F055_OPERATION_CODE,
  contractVersion: F055_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F055CrossDocumentDynamicVariablesValidationError extends Error {
  public readonly featureId = F055_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F055 Validation Error on '${field}']: ${message}`);
    this.name = "F055CrossDocumentDynamicVariablesValidationError";
    this.field = field;
  }
}

export function computeF055Digest(rawPayload: string): string {
  return `f055_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F055CrossDocumentDynamicVariablesEngine {
  private readonly config: F055CrossDocumentDynamicVariablesConfig;
  private readonly kernel: Stage2CanvasKernel;
  private readonly executionHistory: F055CrossDocumentDynamicVariablesOutput[] = [];
  private readonly auditLog: F055CrossDocumentDynamicVariablesAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F055CrossDocumentDynamicVariablesOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F055CrossDocumentDynamicVariablesConfig>, kernel?: Stage2CanvasKernel) {
    this.config = {
      ...DEFAULT_F055_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage2CanvasKernel();
  }

  public getConfig(): F055CrossDocumentDynamicVariablesConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F055CrossDocumentDynamicVariablesInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F055CrossDocumentDynamicVariablesValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.variable_key).trim().length === 0) {
      throw new F055CrossDocumentDynamicVariablesValidationError("variable_key", "Primary domain attribute 'variable_key' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      variable_key: input.variable_key,
      updated_value: input.updated_value,
      bound_locations_updated: input.bound_locations_updated,
      interpolated_text: input.interpolated_text
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F055CrossDocumentDynamicVariablesValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F055CrossDocumentDynamicVariablesInput): F055CrossDocumentDynamicVariablesOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F055_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        variable_key: input.variable_key,
        updated_value: input.updated_value,
        bound_locations_updated: input.bound_locations_updated,
        interpolated_text: input.interpolated_text
      });
      const payloadHash = computeF055Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F055CrossDocumentDynamicVariablesValidationError(
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
        featureId: F055_FEATURE_ID,
        operationCode: F055_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          variable_key: input.variable_key,
          updated_value: input.updated_value,
          bound_locations_updated: input.bound_locations_updated,
          interpolated_text: input.interpolated_text
        }
      });

      const executionId = `exec_f055_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f055_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F055CrossDocumentDynamicVariablesAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F055_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `reactive_variable_binder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F055CrossDocumentDynamicVariablesOutput = {
        featureId: F055_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F055_OPERATION_CODE,
        resolved_variable_key: kernelResult.resolvedFields.variable_key as string,
        resolved_updated_value: kernelResult.resolvedFields.updated_value as string | number,
        resolved_bound_locations_updated: kernelResult.resolvedFields.bound_locations_updated as string | number | boolean | readonly string[],
        resolved_interpolated_text: kernelResult.resolvedFields.interpolated_text as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F055CrossDocumentDynamicVariablesTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F055_FEATURE_ID,
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

  public getAuditTrail(): readonly F055CrossDocumentDynamicVariablesAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F055CrossDocumentDynamicVariablesOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF055Module(): {
  featureId: typeof F055_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F055CrossDocumentDynamicVariablesEngine();
  const sampleInput: F055CrossDocumentDynamicVariablesInput = {
    requestId: "req_verify_f055",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    variable_key: "f055_variable_key_seed",
    updated_value: 42,
    bound_locations_updated: true,
    interpolated_text: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 55 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F055" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_variable_key !== sampleInput.variable_key &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F055_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
