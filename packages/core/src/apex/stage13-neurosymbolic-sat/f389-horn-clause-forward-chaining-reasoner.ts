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

export const F389_FEATURE_ID = "F389" as const;
export const F389_STAGE = "stage13-neurosymbolic-sat" as const;
export const F389_OPERATION_CODE = "F389_HORN_CLAUSE_FORWARD_CHAINING_REASONER" as const;
export const F389_CONTRACT_VERSION = "2.0.0" as const;

export type F389HornClauseForwardChainingReasonerConfig = BaseFeatureConfig<
  typeof F389_FEATURE_ID,
  typeof F389_STAGE,
  typeof F389_OPERATION_CODE
>;

export interface F389HornClauseForwardChainingReasonerInput extends BaseFeatureInput {
  readonly horn_rules: string | number | boolean | readonly string[];
  readonly initial_assertions: string | number | boolean | readonly string[];
  readonly goal_atom: string | number | boolean | readonly string[];
  readonly derivation_depth_cap: string | number | boolean | readonly string[];
}

export interface F389HornClauseForwardChainingReasonerOutput {
  readonly featureId: typeof F389_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F389_OPERATION_CODE;
  readonly resolved_horn_rules: unknown;
  readonly resolved_initial_assertions: unknown;
  readonly resolved_goal_atom: unknown;
  readonly resolved_derivation_depth_cap: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F389_FEATURE_ID>;
}

export type F389HornClauseForwardChainingReasonerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F389_FEATURE_ID
>;

export const DEFAULT_F389_CONFIG: F389HornClauseForwardChainingReasonerConfig = {
  featureId: F389_FEATURE_ID,
  stage: F389_STAGE,
  operationCode: F389_OPERATION_CODE,
  contractVersion: F389_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F389HornClauseForwardChainingReasonerValidationError extends Error {
  public readonly featureId = F389_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F389 Validation Error on '${field}']: ${message}`);
    this.name = "F389HornClauseForwardChainingReasonerValidationError";
    this.field = field;
  }
}

export function computeF389Digest(rawPayload: string): string {
  return `f389_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F389HornClauseForwardChainingReasonerService extends KosmoraFeatureAdapterBase<
  typeof F389_FEATURE_ID,
  typeof F389_STAGE,
  typeof F389_OPERATION_CODE,
  F389HornClauseForwardChainingReasonerConfig,
  F389HornClauseForwardChainingReasonerInput,
  F389HornClauseForwardChainingReasonerOutput
> {
  constructor(
    customConfig?: Partial<F389HornClauseForwardChainingReasonerConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F389_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["horn_rules", "initial_assertions", "goal_atom", "derivation_depth_cap"] as const,
      F389HornClauseForwardChainingReasonerValidationError
    );
  }
}

export function verifyF389Module(): {
  readonly featureId: typeof F389_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F389HornClauseForwardChainingReasonerService();
  const sampleInput: F389HornClauseForwardChainingReasonerInput = {
    requestId: "req_verify_f389",
    projectId: "proj_kosmora_f389",
    workspaceId: "ws_kosmora_f389",
    tenantId: "tenant_rlm_f389",
    actorId: "actor_verifier_f389",
    autonomyLevel: "A3",
    horn_rules: "seed_f389_horn_rules",
    initial_assertions: 42,
    goal_atom: true,
    derivation_depth_cap: "seed_f389_derivation_depth_cap",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F389" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F389" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_horn_rules !== sampleInput.horn_rules &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F389] Verification failed`);
  }

  return {
    featureId: F389_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
