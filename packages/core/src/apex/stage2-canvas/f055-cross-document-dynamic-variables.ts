/**
 * F055 (stage2-canvas): Сквозные переменные в документах
 * Динамические плейсхолдеры, которые обновляются во всём тексте при смене цифры в таблице
 * Operation Code: reactive_variable_binder
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F055_FEATURE_ID = "F055" as const;
export const F055_STAGE = "stage2-canvas" as const;
export const F055_OPERATION_CODE = "reactive_variable_binder" as const;
export const F055_CONTRACT_VERSION = "2.0.0" as const;

export type F055CrossDocumentDynamicVariablesExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F055CrossDocumentDynamicVariablesConfig = BaseFeatureConfig<
  typeof F055_FEATURE_ID,
  typeof F055_STAGE,
  typeof F055_OPERATION_CODE
>;

export interface F055CrossDocumentDynamicVariablesInput extends BaseFeatureInput {
  readonly variable_key: string;
  readonly updated_value: string | number;
  readonly bound_locations_updated: string | number | boolean | readonly string[];
  readonly interpolated_text: string | number | boolean | Record<string, unknown>;
}

export type F055CrossDocumentDynamicVariablesAuditEntry = BaseFeatureAuditEntry<
  typeof F055_FEATURE_ID
>;

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

export type F055CrossDocumentDynamicVariablesTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F055_FEATURE_ID
>;

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

export class F055CrossDocumentDynamicVariablesEngine extends KosmoraFeatureAdapterBase<
  typeof F055_FEATURE_ID,
  typeof F055_STAGE,
  typeof F055_OPERATION_CODE,
  F055CrossDocumentDynamicVariablesConfig,
  F055CrossDocumentDynamicVariablesInput,
  F055CrossDocumentDynamicVariablesOutput
> {
  constructor(
    customConfig?: Partial<F055CrossDocumentDynamicVariablesConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F055_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["variable_key", "updated_value", "bound_locations_updated", "interpolated_text"] as const,
      F055CrossDocumentDynamicVariablesValidationError
    );
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
