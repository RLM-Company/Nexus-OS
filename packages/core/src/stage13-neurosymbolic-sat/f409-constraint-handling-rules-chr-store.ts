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

export const F409_FEATURE_ID = "F409" as const;
export const F409_STAGE = "stage13-neurosymbolic-sat" as const;
export const F409_OPERATION_CODE = "F409_CONSTRAINT_HANDLING_RULES_CHR_STORE" as const;
export const F409_CONTRACT_VERSION = "2.0.0" as const;

export type F409ConstraintHandlingRulesChrStoreConfig = BaseFeatureConfig<
  typeof F409_FEATURE_ID,
  typeof F409_STAGE,
  typeof F409_OPERATION_CODE
>;

export interface F409ConstraintHandlingRulesChrStoreInput extends BaseFeatureInput {
  readonly chr_simplification_rules: string | number | boolean | readonly string[];
  readonly chr_propagation_rules: string | number | boolean | readonly string[];
  readonly initial_constraint_store: string | number | boolean | readonly string[];
  readonly max_firings: string | number | boolean | readonly string[];
}

export interface F409ConstraintHandlingRulesChrStoreOutput {
  readonly featureId: typeof F409_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F409_OPERATION_CODE;
  readonly resolved_chr_simplification_rules: unknown;
  readonly resolved_chr_propagation_rules: unknown;
  readonly resolved_initial_constraint_store: unknown;
  readonly resolved_max_firings: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F409_FEATURE_ID>;
}

export type F409ConstraintHandlingRulesChrStoreTelemetrySnapshot = BaseFeatureTelemetry<typeof F409_FEATURE_ID>;

export const DEFAULT_F409_CONFIG: F409ConstraintHandlingRulesChrStoreConfig = {
  featureId: F409_FEATURE_ID,
  stage: F409_STAGE,
  operationCode: F409_OPERATION_CODE,
  contractVersion: F409_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F409ConstraintHandlingRulesChrStoreValidationError extends Error {
  public readonly featureId = F409_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F409 Validation Error on '${field}']: ${message}`);
    this.name = "F409ConstraintHandlingRulesChrStoreValidationError";
    this.field = field;
  }
}

export function computeF409Digest(rawPayload: string): string {
  return `f409_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F409ConstraintHandlingRulesChrStoreService extends KosmoraFeatureAdapterBase<
  typeof F409_FEATURE_ID,
  typeof F409_STAGE,
  typeof F409_OPERATION_CODE,
  F409ConstraintHandlingRulesChrStoreConfig,
  F409ConstraintHandlingRulesChrStoreInput,
  F409ConstraintHandlingRulesChrStoreOutput
> {
  constructor(customConfig?: Partial<F409ConstraintHandlingRulesChrStoreConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F409_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["chr_simplification_rules", "chr_propagation_rules", "initial_constraint_store", "max_firings"] as const,
      F409ConstraintHandlingRulesChrStoreValidationError
    );
  }
}

export function verifyF409Module(): {
  readonly featureId: typeof F409_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F409ConstraintHandlingRulesChrStoreService();
  const sampleInput: F409ConstraintHandlingRulesChrStoreInput = {
    requestId: "req_verify_f409",
    projectId: "proj_kosmora_f409",
    workspaceId: "ws_kosmora_f409",
    tenantId: "tenant_rlm_f409",
    actorId: "actor_verifier_f409",
    autonomyLevel: "A3",
    chr_simplification_rules: "seed_f409_chr_simplification_rules",
    chr_propagation_rules: 42,
    initial_constraint_store: true,
    max_firings: "seed_f409_max_firings",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F409" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F409" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_chr_simplification_rules !== sampleInput.chr_simplification_rules &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F409] Verification failed`);
  }

  return {
    featureId: F409_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
