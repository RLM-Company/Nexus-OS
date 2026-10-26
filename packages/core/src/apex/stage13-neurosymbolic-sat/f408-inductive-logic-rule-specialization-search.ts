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

export const F408_FEATURE_ID = "F408" as const;
export const F408_STAGE = "stage13-neurosymbolic-sat" as const;
export const F408_OPERATION_CODE = "F408_INDUCTIVE_LOGIC_RULE_SPECIALIZATION_SEARCH" as const;
export const F408_CONTRACT_VERSION = "2.0.0" as const;

export type F408InductiveLogicRuleSpecializationSearchConfig = BaseFeatureConfig<
  typeof F408_FEATURE_ID,
  typeof F408_STAGE,
  typeof F408_OPERATION_CODE
>;

export interface F408InductiveLogicRuleSpecializationSearchInput extends BaseFeatureInput {
  readonly positive_examples: string | number | boolean | readonly string[];
  readonly negative_examples: string | number | boolean | readonly string[];
  readonly background_predicates: string | number | boolean | readonly string[];
  readonly foil_gain_threshold: string | number | boolean | readonly string[];
}

export interface F408InductiveLogicRuleSpecializationSearchOutput {
  readonly featureId: typeof F408_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F408_OPERATION_CODE;
  readonly resolved_positive_examples: unknown;
  readonly resolved_negative_examples: unknown;
  readonly resolved_background_predicates: unknown;
  readonly resolved_foil_gain_threshold: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F408_FEATURE_ID>;
}

export type F408InductiveLogicRuleSpecializationSearchTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F408_FEATURE_ID
>;

export const DEFAULT_F408_CONFIG: F408InductiveLogicRuleSpecializationSearchConfig = {
  featureId: F408_FEATURE_ID,
  stage: F408_STAGE,
  operationCode: F408_OPERATION_CODE,
  contractVersion: F408_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F408InductiveLogicRuleSpecializationSearchValidationError extends Error {
  public readonly featureId = F408_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F408 Validation Error on '${field}']: ${message}`);
    this.name = "F408InductiveLogicRuleSpecializationSearchValidationError";
    this.field = field;
  }
}

export function computeF408Digest(rawPayload: string): string {
  return `f408_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F408InductiveLogicRuleSpecializationSearchService extends KosmoraFeatureAdapterBase<
  typeof F408_FEATURE_ID,
  typeof F408_STAGE,
  typeof F408_OPERATION_CODE,
  F408InductiveLogicRuleSpecializationSearchConfig,
  F408InductiveLogicRuleSpecializationSearchInput,
  F408InductiveLogicRuleSpecializationSearchOutput
> {
  constructor(
    customConfig?: Partial<F408InductiveLogicRuleSpecializationSearchConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F408_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      [
        "positive_examples",
        "negative_examples",
        "background_predicates",
        "foil_gain_threshold"
      ] as const,
      F408InductiveLogicRuleSpecializationSearchValidationError
    );
  }
}

export function verifyF408Module(): {
  readonly featureId: typeof F408_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F408InductiveLogicRuleSpecializationSearchService();
  const sampleInput: F408InductiveLogicRuleSpecializationSearchInput = {
    requestId: "req_verify_f408",
    projectId: "proj_kosmora_f408",
    workspaceId: "ws_kosmora_f408",
    tenantId: "tenant_rlm_f408",
    actorId: "actor_verifier_f408",
    autonomyLevel: "A3",
    positive_examples: "seed_f408_positive_examples",
    negative_examples: 42,
    background_predicates: true,
    foil_gain_threshold: "seed_f408_foil_gain_threshold",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F408" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F408" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_positive_examples !== sampleInput.positive_examples &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F408] Verification failed`);
  }

  return {
    featureId: F408_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
