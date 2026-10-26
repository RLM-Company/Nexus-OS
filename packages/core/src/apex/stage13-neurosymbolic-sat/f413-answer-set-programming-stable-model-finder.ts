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

export const F413_FEATURE_ID = "F413" as const;
export const F413_STAGE = "stage13-neurosymbolic-sat" as const;
export const F413_OPERATION_CODE = "F413_ANSWER_SET_PROGRAMMING_STABLE_MODEL_FINDER" as const;
export const F413_CONTRACT_VERSION = "2.0.0" as const;

export type F413AnswerSetProgrammingStableModelFinderConfig = BaseFeatureConfig<
  typeof F413_FEATURE_ID,
  typeof F413_STAGE,
  typeof F413_OPERATION_CODE
>;

export interface F413AnswerSetProgrammingStableModelFinderInput extends BaseFeatureInput {
  readonly asp_rules: string | number | boolean | readonly string[];
  readonly default_negation_atoms: string | number | boolean | readonly string[];
  readonly choice_rules: string | number | boolean | readonly string[];
  readonly integrity_constraints: string | number | boolean | readonly string[];
}

export interface F413AnswerSetProgrammingStableModelFinderOutput {
  readonly featureId: typeof F413_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F413_OPERATION_CODE;
  readonly resolved_asp_rules: unknown;
  readonly resolved_default_negation_atoms: unknown;
  readonly resolved_choice_rules: unknown;
  readonly resolved_integrity_constraints: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F413_FEATURE_ID>;
}

export type F413AnswerSetProgrammingStableModelFinderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F413_FEATURE_ID
>;

export const DEFAULT_F413_CONFIG: F413AnswerSetProgrammingStableModelFinderConfig = {
  featureId: F413_FEATURE_ID,
  stage: F413_STAGE,
  operationCode: F413_OPERATION_CODE,
  contractVersion: F413_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F413AnswerSetProgrammingStableModelFinderValidationError extends Error {
  public readonly featureId = F413_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F413 Validation Error on '${field}']: ${message}`);
    this.name = "F413AnswerSetProgrammingStableModelFinderValidationError";
    this.field = field;
  }
}

export function computeF413Digest(rawPayload: string): string {
  return `f413_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F413AnswerSetProgrammingStableModelFinderService extends KosmoraFeatureAdapterBase<
  typeof F413_FEATURE_ID,
  typeof F413_STAGE,
  typeof F413_OPERATION_CODE,
  F413AnswerSetProgrammingStableModelFinderConfig,
  F413AnswerSetProgrammingStableModelFinderInput,
  F413AnswerSetProgrammingStableModelFinderOutput
> {
  constructor(
    customConfig?: Partial<F413AnswerSetProgrammingStableModelFinderConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F413_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["asp_rules", "default_negation_atoms", "choice_rules", "integrity_constraints"] as const,
      F413AnswerSetProgrammingStableModelFinderValidationError
    );
  }
}

export function verifyF413Module(): {
  readonly featureId: typeof F413_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F413AnswerSetProgrammingStableModelFinderService();
  const sampleInput: F413AnswerSetProgrammingStableModelFinderInput = {
    requestId: "req_verify_f413",
    projectId: "proj_kosmora_f413",
    workspaceId: "ws_kosmora_f413",
    tenantId: "tenant_rlm_f413",
    actorId: "actor_verifier_f413",
    autonomyLevel: "A3",
    asp_rules: "seed_f413_asp_rules",
    default_negation_atoms: 42,
    choice_rules: true,
    integrity_constraints: "seed_f413_integrity_constraints",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F413" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F413" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_asp_rules !== sampleInput.asp_rules &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F413] Verification failed`);
  }

  return {
    featureId: F413_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
