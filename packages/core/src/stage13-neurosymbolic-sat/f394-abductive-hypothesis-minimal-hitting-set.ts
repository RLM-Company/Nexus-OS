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

export const F394_FEATURE_ID = "F394" as const;
export const F394_STAGE = "stage13-neurosymbolic-sat" as const;
export const F394_OPERATION_CODE = "F394_ABDUCTIVE_HYPOTHESIS_MINIMAL_HITTING_SET" as const;
export const F394_CONTRACT_VERSION = "2.0.0" as const;

export type F394AbductiveHypothesisMinimalHittingSetConfig = BaseFeatureConfig<
  typeof F394_FEATURE_ID,
  typeof F394_STAGE,
  typeof F394_OPERATION_CODE
>;

export interface F394AbductiveHypothesisMinimalHittingSetInput extends BaseFeatureInput {
  readonly observations: string | number | boolean | readonly string[];
  readonly background_rules: string | number | boolean | readonly string[];
  readonly candidate_abducibles: string | number | boolean | readonly string[];
  readonly parsimony_weight: string | number | boolean | readonly string[];
}

export interface F394AbductiveHypothesisMinimalHittingSetOutput {
  readonly featureId: typeof F394_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F394_OPERATION_CODE;
  readonly resolved_observations: unknown;
  readonly resolved_background_rules: unknown;
  readonly resolved_candidate_abducibles: unknown;
  readonly resolved_parsimony_weight: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F394_FEATURE_ID>;
}

export type F394AbductiveHypothesisMinimalHittingSetTelemetrySnapshot = BaseFeatureTelemetry<typeof F394_FEATURE_ID>;

export const DEFAULT_F394_CONFIG: F394AbductiveHypothesisMinimalHittingSetConfig = {
  featureId: F394_FEATURE_ID,
  stage: F394_STAGE,
  operationCode: F394_OPERATION_CODE,
  contractVersion: F394_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F394AbductiveHypothesisMinimalHittingSetValidationError extends Error {
  public readonly featureId = F394_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F394 Validation Error on '${field}']: ${message}`);
    this.name = "F394AbductiveHypothesisMinimalHittingSetValidationError";
    this.field = field;
  }
}

export function computeF394Digest(rawPayload: string): string {
  return `f394_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F394AbductiveHypothesisMinimalHittingSetService extends KosmoraFeatureAdapterBase<
  typeof F394_FEATURE_ID,
  typeof F394_STAGE,
  typeof F394_OPERATION_CODE,
  F394AbductiveHypothesisMinimalHittingSetConfig,
  F394AbductiveHypothesisMinimalHittingSetInput,
  F394AbductiveHypothesisMinimalHittingSetOutput
> {
  constructor(customConfig?: Partial<F394AbductiveHypothesisMinimalHittingSetConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F394_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["observations", "background_rules", "candidate_abducibles", "parsimony_weight"] as const,
      F394AbductiveHypothesisMinimalHittingSetValidationError
    );
  }
}

export function verifyF394Module(): {
  readonly featureId: typeof F394_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F394AbductiveHypothesisMinimalHittingSetService();
  const sampleInput: F394AbductiveHypothesisMinimalHittingSetInput = {
    requestId: "req_verify_f394",
    projectId: "proj_kosmora_f394",
    workspaceId: "ws_kosmora_f394",
    tenantId: "tenant_rlm_f394",
    actorId: "actor_verifier_f394",
    autonomyLevel: "A3",
    observations: "seed_f394_observations",
    background_rules: 42,
    candidate_abducibles: true,
    parsimony_weight: "seed_f394_parsimony_weight",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F394" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F394" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_observations !== sampleInput.observations &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F394] Verification failed`);
  }

  return {
    featureId: F394_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
