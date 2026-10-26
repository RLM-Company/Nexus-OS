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

export const F422_FEATURE_ID = "F422" as const;
export const F422_STAGE = "stage14-cybernetic-control" as const;
export const F422_OPERATION_CODE = "F422_LYAPUNOV_QUADRATIC_STABILITY_CERTIFIER" as const;
export const F422_CONTRACT_VERSION = "2.0.0" as const;

export type F422LyapunovQuadraticStabilityCertifierConfig = BaseFeatureConfig<
  typeof F422_FEATURE_ID,
  typeof F422_STAGE,
  typeof F422_OPERATION_CODE
>;

export interface F422LyapunovQuadraticStabilityCertifierInput extends BaseFeatureInput {
  readonly system_matrix_a: string | number | boolean | readonly string[];
  readonly candidate_lyapunov_p: string | number | boolean | readonly string[];
  readonly decay_rate_margin: string | number | boolean | readonly string[];
  readonly discrete_time_mode: string | number | boolean | readonly string[];
}

export interface F422LyapunovQuadraticStabilityCertifierOutput {
  readonly featureId: typeof F422_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F422_OPERATION_CODE;
  readonly resolved_system_matrix_a: unknown;
  readonly resolved_candidate_lyapunov_p: unknown;
  readonly resolved_decay_rate_margin: unknown;
  readonly resolved_discrete_time_mode: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F422_FEATURE_ID>;
}

export type F422LyapunovQuadraticStabilityCertifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F422_FEATURE_ID>;

export const DEFAULT_F422_CONFIG: F422LyapunovQuadraticStabilityCertifierConfig = {
  featureId: F422_FEATURE_ID,
  stage: F422_STAGE,
  operationCode: F422_OPERATION_CODE,
  contractVersion: F422_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F422LyapunovQuadraticStabilityCertifierValidationError extends Error {
  public readonly featureId = F422_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F422 Validation Error on '${field}']: ${message}`);
    this.name = "F422LyapunovQuadraticStabilityCertifierValidationError";
    this.field = field;
  }
}

export function computeF422Digest(rawPayload: string): string {
  return `f422_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F422LyapunovQuadraticStabilityCertifierService extends KosmoraFeatureAdapterBase<
  typeof F422_FEATURE_ID,
  typeof F422_STAGE,
  typeof F422_OPERATION_CODE,
  F422LyapunovQuadraticStabilityCertifierConfig,
  F422LyapunovQuadraticStabilityCertifierInput,
  F422LyapunovQuadraticStabilityCertifierOutput
> {
  constructor(customConfig?: Partial<F422LyapunovQuadraticStabilityCertifierConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F422_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["system_matrix_a", "candidate_lyapunov_p", "decay_rate_margin", "discrete_time_mode"] as const,
      F422LyapunovQuadraticStabilityCertifierValidationError
    );
  }
}

export function verifyF422Module(): {
  readonly featureId: typeof F422_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F422LyapunovQuadraticStabilityCertifierService();
  const sampleInput: F422LyapunovQuadraticStabilityCertifierInput = {
    requestId: "req_verify_f422",
    projectId: "proj_kosmora_f422",
    workspaceId: "ws_kosmora_f422",
    tenantId: "tenant_rlm_f422",
    actorId: "actor_verifier_f422",
    autonomyLevel: "A3",
    system_matrix_a: "seed_f422_system_matrix_a",
    candidate_lyapunov_p: 42,
    decay_rate_margin: true,
    discrete_time_mode: "seed_f422_discrete_time_mode",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F422" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F422" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_system_matrix_a !== sampleInput.system_matrix_a &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F422] Verification failed`);
  }

  return {
    featureId: F422_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
