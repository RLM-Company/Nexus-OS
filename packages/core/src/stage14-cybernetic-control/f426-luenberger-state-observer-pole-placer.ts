import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage14CyberneticControlKernel } from "./stage-kernel.js";

export const F426_FEATURE_ID = "F426" as const;
export const F426_STAGE = "stage14-cybernetic-control" as const;
export const F426_OPERATION_CODE = "F426_LUENBERGER_STATE_OBSERVER_POLE_PLACER" as const;
export const F426_CONTRACT_VERSION = "2.0.0" as const;

export type F426LuenbergerStateObserverPolePlacerConfig = BaseFeatureConfig<
  typeof F426_FEATURE_ID,
  typeof F426_STAGE,
  typeof F426_OPERATION_CODE
>;

export interface F426LuenbergerStateObserverPolePlacerInput extends BaseFeatureInput {
  readonly system_matrix_a: string | number | boolean | readonly string[];
  readonly output_matrix_c: string | number | boolean | readonly string[];
  readonly desired_observer_poles: string | number | boolean | readonly string[];
  readonly measurement_residuals: string | number | boolean | readonly string[];
}

export interface F426LuenbergerStateObserverPolePlacerOutput {
  readonly featureId: typeof F426_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F426_OPERATION_CODE;
  readonly resolved_system_matrix_a: unknown;
  readonly resolved_output_matrix_c: unknown;
  readonly resolved_desired_observer_poles: unknown;
  readonly resolved_measurement_residuals: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F426_FEATURE_ID>;
}

export type F426LuenbergerStateObserverPolePlacerTelemetrySnapshot = BaseFeatureTelemetry<typeof F426_FEATURE_ID>;

export const DEFAULT_F426_CONFIG: F426LuenbergerStateObserverPolePlacerConfig = {
  featureId: F426_FEATURE_ID,
  stage: F426_STAGE,
  operationCode: F426_OPERATION_CODE,
  contractVersion: F426_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F426LuenbergerStateObserverPolePlacerValidationError extends Error {
  public readonly featureId = F426_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F426 Validation Error on '${field}']: ${message}`);
    this.name = "F426LuenbergerStateObserverPolePlacerValidationError";
    this.field = field;
  }
}

export function computeF426Digest(rawPayload: string): string {
  return `f426_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F426LuenbergerStateObserverPolePlacerService extends KosmoraFeatureAdapterBase<
  typeof F426_FEATURE_ID,
  typeof F426_STAGE,
  typeof F426_OPERATION_CODE,
  F426LuenbergerStateObserverPolePlacerConfig,
  F426LuenbergerStateObserverPolePlacerInput,
  F426LuenbergerStateObserverPolePlacerOutput
> {
  constructor(customConfig?: Partial<F426LuenbergerStateObserverPolePlacerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F426_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["system_matrix_a", "output_matrix_c", "desired_observer_poles", "measurement_residuals"] as const,
      F426LuenbergerStateObserverPolePlacerValidationError
    );
  }
}

export function verifyF426Module(): {
  readonly featureId: typeof F426_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F426LuenbergerStateObserverPolePlacerService();
  const sampleInput: F426LuenbergerStateObserverPolePlacerInput = {
    requestId: "req_verify_f426",
    projectId: "proj_kosmora_f426",
    workspaceId: "ws_kosmora_f426",
    tenantId: "tenant_rlm_f426",
    actorId: "actor_verifier_f426",
    autonomyLevel: "A3",
    system_matrix_a: "seed_f426_system_matrix_a",
    output_matrix_c: 42,
    desired_observer_poles: true,
    measurement_residuals: "seed_f426_measurement_residuals",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F426" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F426" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_system_matrix_a !== sampleInput.system_matrix_a &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F426] Verification failed`);
  }

  return {
    featureId: F426_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
