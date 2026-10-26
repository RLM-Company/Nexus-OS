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

export const F425_FEATURE_ID = "F425" as const;
export const F425_STAGE = "stage14-cybernetic-control" as const;
export const F425_OPERATION_CODE = "F425_EXTENDED_KALMAN_JACOBIAN_LINEARIZER" as const;
export const F425_CONTRACT_VERSION = "2.0.0" as const;

export type F425ExtendedKalmanJacobianLinearizerConfig = BaseFeatureConfig<
  typeof F425_FEATURE_ID,
  typeof F425_STAGE,
  typeof F425_OPERATION_CODE
>;

export interface F425ExtendedKalmanJacobianLinearizerInput extends BaseFeatureInput {
  readonly nonlinear_state_fn: string | number | boolean | readonly string[];
  readonly jacobian_f_matrix: string | number | boolean | readonly string[];
  readonly innovation_sequence: string | number | boolean | readonly string[];
  readonly covariance_p_prior: string | number | boolean | readonly string[];
}

export interface F425ExtendedKalmanJacobianLinearizerOutput {
  readonly featureId: typeof F425_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F425_OPERATION_CODE;
  readonly resolved_nonlinear_state_fn: unknown;
  readonly resolved_jacobian_f_matrix: unknown;
  readonly resolved_innovation_sequence: unknown;
  readonly resolved_covariance_p_prior: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F425_FEATURE_ID>;
}

export type F425ExtendedKalmanJacobianLinearizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F425_FEATURE_ID>;

export const DEFAULT_F425_CONFIG: F425ExtendedKalmanJacobianLinearizerConfig = {
  featureId: F425_FEATURE_ID,
  stage: F425_STAGE,
  operationCode: F425_OPERATION_CODE,
  contractVersion: F425_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F425ExtendedKalmanJacobianLinearizerValidationError extends Error {
  public readonly featureId = F425_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F425 Validation Error on '${field}']: ${message}`);
    this.name = "F425ExtendedKalmanJacobianLinearizerValidationError";
    this.field = field;
  }
}

export function computeF425Digest(rawPayload: string): string {
  return `f425_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F425ExtendedKalmanJacobianLinearizerService extends KosmoraFeatureAdapterBase<
  typeof F425_FEATURE_ID,
  typeof F425_STAGE,
  typeof F425_OPERATION_CODE,
  F425ExtendedKalmanJacobianLinearizerConfig,
  F425ExtendedKalmanJacobianLinearizerInput,
  F425ExtendedKalmanJacobianLinearizerOutput
> {
  constructor(customConfig?: Partial<F425ExtendedKalmanJacobianLinearizerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F425_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["nonlinear_state_fn", "jacobian_f_matrix", "innovation_sequence", "covariance_p_prior"] as const,
      F425ExtendedKalmanJacobianLinearizerValidationError
    );
  }
}

export function verifyF425Module(): {
  readonly featureId: typeof F425_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F425ExtendedKalmanJacobianLinearizerService();
  const sampleInput: F425ExtendedKalmanJacobianLinearizerInput = {
    requestId: "req_verify_f425",
    projectId: "proj_kosmora_f425",
    workspaceId: "ws_kosmora_f425",
    tenantId: "tenant_rlm_f425",
    actorId: "actor_verifier_f425",
    autonomyLevel: "A3",
    nonlinear_state_fn: "seed_f425_nonlinear_state_fn",
    jacobian_f_matrix: 42,
    innovation_sequence: true,
    covariance_p_prior: "seed_f425_covariance_p_prior",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F425" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F425" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_nonlinear_state_fn !== sampleInput.nonlinear_state_fn &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F425] Verification failed`);
  }

  return {
    featureId: F425_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
