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

export const F442_FEATURE_ID = "F442" as const;
export const F442_STAGE = "stage14-cybernetic-control" as const;
export const F442_OPERATION_CODE = "F442_AIMD_CONGESTION_WINDOW_FAIRNESS_CONTROLLER" as const;
export const F442_CONTRACT_VERSION = "2.0.0" as const;

export type F442AimdCongestionWindowFairnessControllerConfig = BaseFeatureConfig<
  typeof F442_FEATURE_ID,
  typeof F442_STAGE,
  typeof F442_OPERATION_CODE
>;

export interface F442AimdCongestionWindowFairnessControllerInput extends BaseFeatureInput {
  readonly flow_rates_initial: string | number | boolean | readonly string[];
  readonly link_capacity_c: string | number | boolean | readonly string[];
  readonly additive_increase_alpha: string | number | boolean | readonly string[];
  readonly multiplicative_decrease_beta: string | number | boolean | readonly string[];
}

export interface F442AimdCongestionWindowFairnessControllerOutput {
  readonly featureId: typeof F442_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F442_OPERATION_CODE;
  readonly resolved_flow_rates_initial: unknown;
  readonly resolved_link_capacity_c: unknown;
  readonly resolved_additive_increase_alpha: unknown;
  readonly resolved_multiplicative_decrease_beta: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F442_FEATURE_ID>;
}

export type F442AimdCongestionWindowFairnessControllerTelemetrySnapshot = BaseFeatureTelemetry<typeof F442_FEATURE_ID>;

export const DEFAULT_F442_CONFIG: F442AimdCongestionWindowFairnessControllerConfig = {
  featureId: F442_FEATURE_ID,
  stage: F442_STAGE,
  operationCode: F442_OPERATION_CODE,
  contractVersion: F442_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F442AimdCongestionWindowFairnessControllerValidationError extends Error {
  public readonly featureId = F442_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F442 Validation Error on '${field}']: ${message}`);
    this.name = "F442AimdCongestionWindowFairnessControllerValidationError";
    this.field = field;
  }
}

export function computeF442Digest(rawPayload: string): string {
  return `f442_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F442AimdCongestionWindowFairnessControllerService extends KosmoraFeatureAdapterBase<
  typeof F442_FEATURE_ID,
  typeof F442_STAGE,
  typeof F442_OPERATION_CODE,
  F442AimdCongestionWindowFairnessControllerConfig,
  F442AimdCongestionWindowFairnessControllerInput,
  F442AimdCongestionWindowFairnessControllerOutput
> {
  constructor(customConfig?: Partial<F442AimdCongestionWindowFairnessControllerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F442_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["flow_rates_initial", "link_capacity_c", "additive_increase_alpha", "multiplicative_decrease_beta"] as const,
      F442AimdCongestionWindowFairnessControllerValidationError
    );
  }
}

export function verifyF442Module(): {
  readonly featureId: typeof F442_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F442AimdCongestionWindowFairnessControllerService();
  const sampleInput: F442AimdCongestionWindowFairnessControllerInput = {
    requestId: "req_verify_f442",
    projectId: "proj_kosmora_f442",
    workspaceId: "ws_kosmora_f442",
    tenantId: "tenant_rlm_f442",
    actorId: "actor_verifier_f442",
    autonomyLevel: "A3",
    flow_rates_initial: "seed_f442_flow_rates_initial",
    link_capacity_c: 42,
    additive_increase_alpha: true,
    multiplicative_decrease_beta: "seed_f442_multiplicative_decrease_beta",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F442" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F442" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_flow_rates_initial !== sampleInput.flow_rates_initial &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F442] Verification failed`);
  }

  return {
    featureId: F442_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
