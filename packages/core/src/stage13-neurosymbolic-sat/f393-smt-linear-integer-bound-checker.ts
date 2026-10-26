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

export const F393_FEATURE_ID = "F393" as const;
export const F393_STAGE = "stage13-neurosymbolic-sat" as const;
export const F393_OPERATION_CODE = "F393_SMT_LINEAR_INTEGER_BOUND_CHECKER" as const;
export const F393_CONTRACT_VERSION = "2.0.0" as const;

export type F393SmtLinearIntegerBoundCheckerConfig = BaseFeatureConfig<
  typeof F393_FEATURE_ID,
  typeof F393_STAGE,
  typeof F393_OPERATION_CODE
>;

export interface F393SmtLinearIntegerBoundCheckerInput extends BaseFeatureInput {
  readonly linear_inequalities: string | number | boolean | readonly string[];
  readonly integer_bounds: string | number | boolean | readonly string[];
  readonly variable_domains: string | number | boolean | readonly string[];
  readonly tightening_rounds: string | number | boolean | readonly string[];
}

export interface F393SmtLinearIntegerBoundCheckerOutput {
  readonly featureId: typeof F393_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F393_OPERATION_CODE;
  readonly resolved_linear_inequalities: unknown;
  readonly resolved_integer_bounds: unknown;
  readonly resolved_variable_domains: unknown;
  readonly resolved_tightening_rounds: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F393_FEATURE_ID>;
}

export type F393SmtLinearIntegerBoundCheckerTelemetrySnapshot = BaseFeatureTelemetry<typeof F393_FEATURE_ID>;

export const DEFAULT_F393_CONFIG: F393SmtLinearIntegerBoundCheckerConfig = {
  featureId: F393_FEATURE_ID,
  stage: F393_STAGE,
  operationCode: F393_OPERATION_CODE,
  contractVersion: F393_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F393SmtLinearIntegerBoundCheckerValidationError extends Error {
  public readonly featureId = F393_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F393 Validation Error on '${field}']: ${message}`);
    this.name = "F393SmtLinearIntegerBoundCheckerValidationError";
    this.field = field;
  }
}

export function computeF393Digest(rawPayload: string): string {
  return `f393_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F393SmtLinearIntegerBoundCheckerService extends KosmoraFeatureAdapterBase<
  typeof F393_FEATURE_ID,
  typeof F393_STAGE,
  typeof F393_OPERATION_CODE,
  F393SmtLinearIntegerBoundCheckerConfig,
  F393SmtLinearIntegerBoundCheckerInput,
  F393SmtLinearIntegerBoundCheckerOutput
> {
  constructor(customConfig?: Partial<F393SmtLinearIntegerBoundCheckerConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F393_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["linear_inequalities", "integer_bounds", "variable_domains", "tightening_rounds"] as const,
      F393SmtLinearIntegerBoundCheckerValidationError
    );
  }
}

export function verifyF393Module(): {
  readonly featureId: typeof F393_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F393SmtLinearIntegerBoundCheckerService();
  const sampleInput: F393SmtLinearIntegerBoundCheckerInput = {
    requestId: "req_verify_f393",
    projectId: "proj_kosmora_f393",
    workspaceId: "ws_kosmora_f393",
    tenantId: "tenant_rlm_f393",
    actorId: "actor_verifier_f393",
    autonomyLevel: "A3",
    linear_inequalities: "seed_f393_linear_inequalities",
    integer_bounds: 42,
    variable_domains: true,
    tightening_rounds: "seed_f393_tightening_rounds",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F393" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F393" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_linear_inequalities !== sampleInput.linear_inequalities &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F393] Verification failed`);
  }

  return {
    featureId: F393_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
