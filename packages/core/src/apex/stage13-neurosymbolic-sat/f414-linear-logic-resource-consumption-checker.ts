import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage13NeurosymbolicSatKernel } from "./stage-kernel.js";

export const F414_FEATURE_ID = "F414" as const;
export const F414_STAGE = "stage13-neurosymbolic-sat" as const;
export const F414_OPERATION_CODE = "F414_LINEAR_LOGIC_RESOURCE_CONSUMPTION_CHECKER" as const;
export const F414_CONTRACT_VERSION = "2.0.0" as const;

export type F414LinearLogicResourceConsumptionCheckerConfig = BaseFeatureConfig<
  typeof F414_FEATURE_ID,
  typeof F414_STAGE,
  typeof F414_OPERATION_CODE
>;

export interface F414LinearLogicResourceConsumptionCheckerInput extends BaseFeatureInput {
  readonly linear_hypotheses: string | number | boolean | readonly string[];
  readonly lollipop_rules: string | number | boolean | readonly string[];
  readonly target_multiset: string | number | boolean | readonly string[];
  readonly exponential_bang_set: string | number | boolean | readonly string[];
}

export interface F414LinearLogicResourceConsumptionCheckerOutput {
  readonly featureId: typeof F414_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F414_OPERATION_CODE;
  readonly resolved_linear_hypotheses: unknown;
  readonly resolved_lollipop_rules: unknown;
  readonly resolved_target_multiset: unknown;
  readonly resolved_exponential_bang_set: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F414_FEATURE_ID>;
}

export type F414LinearLogicResourceConsumptionCheckerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F414_FEATURE_ID
>;

export const DEFAULT_F414_CONFIG: F414LinearLogicResourceConsumptionCheckerConfig = {
  featureId: F414_FEATURE_ID,
  stage: F414_STAGE,
  operationCode: F414_OPERATION_CODE,
  contractVersion: F414_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F414LinearLogicResourceConsumptionCheckerValidationError extends Error {
  public readonly featureId = F414_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F414 Validation Error on '${field}']: ${message}`);
    this.name = "F414LinearLogicResourceConsumptionCheckerValidationError";
    this.field = field;
  }
}

export function computeF414Digest(rawPayload: string): string {
  return `f414_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F414LinearLogicResourceConsumptionCheckerService extends KosmoraFeatureAdapterBase<
  typeof F414_FEATURE_ID,
  typeof F414_STAGE,
  typeof F414_OPERATION_CODE,
  F414LinearLogicResourceConsumptionCheckerConfig,
  F414LinearLogicResourceConsumptionCheckerInput,
  F414LinearLogicResourceConsumptionCheckerOutput
> {
  constructor(
    customConfig?: Partial<F414LinearLogicResourceConsumptionCheckerConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F414_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["linear_hypotheses", "lollipop_rules", "target_multiset", "exponential_bang_set"] as const,
      F414LinearLogicResourceConsumptionCheckerValidationError
    );
  }
}

export function verifyF414Module(): {
  readonly featureId: typeof F414_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F414LinearLogicResourceConsumptionCheckerService();
  const sampleInput: F414LinearLogicResourceConsumptionCheckerInput = {
    requestId: "req_verify_f414",
    projectId: "proj_kosmora_f414",
    workspaceId: "ws_kosmora_f414",
    tenantId: "tenant_rlm_f414",
    actorId: "actor_verifier_f414",
    autonomyLevel: "A3",
    linear_hypotheses: "seed_f414_linear_hypotheses",
    lollipop_rules: 42,
    target_multiset: true,
    exponential_bang_set: "seed_f414_exponential_bang_set",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F414" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F414" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_linear_hypotheses !== sampleInput.linear_hypotheses &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F414] Verification failed`);
  }

  return {
    featureId: F414_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
