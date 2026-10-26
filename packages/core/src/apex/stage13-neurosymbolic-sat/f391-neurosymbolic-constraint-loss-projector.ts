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

export const F391_FEATURE_ID = "F391" as const;
export const F391_STAGE = "stage13-neurosymbolic-sat" as const;
export const F391_OPERATION_CODE = "F391_NEUROSYMBOLIC_CONSTRAINT_LOSS_PROJECTOR" as const;
export const F391_CONTRACT_VERSION = "2.0.0" as const;

export type F391NeurosymbolicConstraintLossProjectorConfig = BaseFeatureConfig<
  typeof F391_FEATURE_ID,
  typeof F391_STAGE,
  typeof F391_OPERATION_CODE
>;

export interface F391NeurosymbolicConstraintLossProjectorInput extends BaseFeatureInput {
  readonly neural_logits: string | number | boolean | readonly string[];
  readonly symbolic_cnf_constraints: string | number | boolean | readonly string[];
  readonly temperature_tau: string | number | boolean | readonly string[];
  readonly projection_norm: string | number | boolean | readonly string[];
}

export interface F391NeurosymbolicConstraintLossProjectorOutput {
  readonly featureId: typeof F391_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F391_OPERATION_CODE;
  readonly resolved_neural_logits: unknown;
  readonly resolved_symbolic_cnf_constraints: unknown;
  readonly resolved_temperature_tau: unknown;
  readonly resolved_projection_norm: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F391_FEATURE_ID>;
}

export type F391NeurosymbolicConstraintLossProjectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F391_FEATURE_ID
>;

export const DEFAULT_F391_CONFIG: F391NeurosymbolicConstraintLossProjectorConfig = {
  featureId: F391_FEATURE_ID,
  stage: F391_STAGE,
  operationCode: F391_OPERATION_CODE,
  contractVersion: F391_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F391NeurosymbolicConstraintLossProjectorValidationError extends Error {
  public readonly featureId = F391_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F391 Validation Error on '${field}']: ${message}`);
    this.name = "F391NeurosymbolicConstraintLossProjectorValidationError";
    this.field = field;
  }
}

export function computeF391Digest(rawPayload: string): string {
  return `f391_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F391NeurosymbolicConstraintLossProjectorService extends KosmoraFeatureAdapterBase<
  typeof F391_FEATURE_ID,
  typeof F391_STAGE,
  typeof F391_OPERATION_CODE,
  F391NeurosymbolicConstraintLossProjectorConfig,
  F391NeurosymbolicConstraintLossProjectorInput,
  F391NeurosymbolicConstraintLossProjectorOutput
> {
  constructor(
    customConfig?: Partial<F391NeurosymbolicConstraintLossProjectorConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F391_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["neural_logits", "symbolic_cnf_constraints", "temperature_tau", "projection_norm"] as const,
      F391NeurosymbolicConstraintLossProjectorValidationError
    );
  }
}

export function verifyF391Module(): {
  readonly featureId: typeof F391_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F391NeurosymbolicConstraintLossProjectorService();
  const sampleInput: F391NeurosymbolicConstraintLossProjectorInput = {
    requestId: "req_verify_f391",
    projectId: "proj_kosmora_f391",
    workspaceId: "ws_kosmora_f391",
    tenantId: "tenant_rlm_f391",
    actorId: "actor_verifier_f391",
    autonomyLevel: "A3",
    neural_logits: "seed_f391_neural_logits",
    symbolic_cnf_constraints: 42,
    temperature_tau: true,
    projection_norm: "seed_f391_projection_norm",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F391" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F391" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_neural_logits !== sampleInput.neural_logits &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F391] Verification failed`);
  }

  return {
    featureId: F391_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
