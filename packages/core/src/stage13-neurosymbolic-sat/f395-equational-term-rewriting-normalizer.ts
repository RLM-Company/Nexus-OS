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

export const F395_FEATURE_ID = "F395" as const;
export const F395_STAGE = "stage13-neurosymbolic-sat" as const;
export const F395_OPERATION_CODE = "F395_EQUATIONAL_TERM_REWRITING_NORMALIZER" as const;
export const F395_CONTRACT_VERSION = "2.0.0" as const;

export type F395EquationalTermRewritingNormalizerConfig = BaseFeatureConfig<
  typeof F395_FEATURE_ID,
  typeof F395_STAGE,
  typeof F395_OPERATION_CODE
>;

export interface F395EquationalTermRewritingNormalizerInput extends BaseFeatureInput {
  readonly rewrite_rules: string | number | boolean | readonly string[];
  readonly input_term: string | number | boolean | readonly string[];
  readonly reduction_order: string | number | boolean | readonly string[];
  readonly max_rewrite_steps: string | number | boolean | readonly string[];
}

export interface F395EquationalTermRewritingNormalizerOutput {
  readonly featureId: typeof F395_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F395_OPERATION_CODE;
  readonly resolved_rewrite_rules: unknown;
  readonly resolved_input_term: unknown;
  readonly resolved_reduction_order: unknown;
  readonly resolved_max_rewrite_steps: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F395_FEATURE_ID>;
}

export type F395EquationalTermRewritingNormalizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F395_FEATURE_ID>;

export const DEFAULT_F395_CONFIG: F395EquationalTermRewritingNormalizerConfig = {
  featureId: F395_FEATURE_ID,
  stage: F395_STAGE,
  operationCode: F395_OPERATION_CODE,
  contractVersion: F395_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F395EquationalTermRewritingNormalizerValidationError extends Error {
  public readonly featureId = F395_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F395 Validation Error on '${field}']: ${message}`);
    this.name = "F395EquationalTermRewritingNormalizerValidationError";
    this.field = field;
  }
}

export function computeF395Digest(rawPayload: string): string {
  return `f395_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F395EquationalTermRewritingNormalizerService extends KosmoraFeatureAdapterBase<
  typeof F395_FEATURE_ID,
  typeof F395_STAGE,
  typeof F395_OPERATION_CODE,
  F395EquationalTermRewritingNormalizerConfig,
  F395EquationalTermRewritingNormalizerInput,
  F395EquationalTermRewritingNormalizerOutput
> {
  constructor(customConfig?: Partial<F395EquationalTermRewritingNormalizerConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F395_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["rewrite_rules", "input_term", "reduction_order", "max_rewrite_steps"] as const,
      F395EquationalTermRewritingNormalizerValidationError
    );
  }
}

export function verifyF395Module(): {
  readonly featureId: typeof F395_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F395EquationalTermRewritingNormalizerService();
  const sampleInput: F395EquationalTermRewritingNormalizerInput = {
    requestId: "req_verify_f395",
    projectId: "proj_kosmora_f395",
    workspaceId: "ws_kosmora_f395",
    tenantId: "tenant_rlm_f395",
    actorId: "actor_verifier_f395",
    autonomyLevel: "A3",
    rewrite_rules: "seed_f395_rewrite_rules",
    input_term: 42,
    reduction_order: true,
    max_rewrite_steps: "seed_f395_max_rewrite_steps",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F395" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F395" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_rewrite_rules !== sampleInput.rewrite_rules &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F395] Verification failed`);
  }

  return {
    featureId: F395_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
