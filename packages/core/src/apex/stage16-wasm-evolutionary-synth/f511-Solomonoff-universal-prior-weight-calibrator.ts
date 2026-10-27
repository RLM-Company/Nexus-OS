import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage16WasmEvolutionarySynthKernel } from "./stage-kernel.js";

export const F511_FEATURE_ID = "F511" as const;
export const F511_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F511_OPERATION_CODE = "F511_SOLOMONOFF_UNIVERSAL_PRIOR_WEIGHT_CALIBRATOR" as const;
export const F511_CONTRACT_VERSION = "2.0.0" as const;

export type F511SolomonoffUniversalPriorWeightCalibratorConfig = BaseFeatureConfig<
  typeof F511_FEATURE_ID,
  typeof F511_STAGE,
  typeof F511_OPERATION_CODE
>;

export interface F511SolomonoffUniversalPriorWeightCalibratorInput extends BaseFeatureInput {
  readonly program_lengths_bits: string | number | boolean | readonly string[];
  readonly occam_razor_weights: string | number | boolean | readonly string[];
  readonly normalized_prior_probs: string | number | boolean | readonly string[];
  readonly shortest_program_id: string | number | boolean | readonly string[];
}

export interface F511SolomonoffUniversalPriorWeightCalibratorOutput {
  readonly featureId: typeof F511_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F511_OPERATION_CODE;
  readonly resolved_program_lengths_bits: unknown;
  readonly resolved_occam_razor_weights: unknown;
  readonly resolved_normalized_prior_probs: unknown;
  readonly resolved_shortest_program_id: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F511_FEATURE_ID>;
}

export type F511SolomonoffUniversalPriorWeightCalibratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F511_FEATURE_ID
>;

export const DEFAULT_F511_CONFIG: F511SolomonoffUniversalPriorWeightCalibratorConfig = {
  featureId: F511_FEATURE_ID,
  stage: F511_STAGE,
  operationCode: F511_OPERATION_CODE,
  contractVersion: F511_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F511SolomonoffUniversalPriorWeightCalibratorValidationError extends Error {
  public readonly featureId = F511_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F511 Validation Error on '${field}']: ${message}`);
    this.name = "F511SolomonoffUniversalPriorWeightCalibratorValidationError";
    this.field = field;
  }
}

export function computeF511Digest(rawPayload: string): string {
  return `f511_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F511SolomonoffUniversalPriorWeightCalibratorService extends KosmoraFeatureAdapterBase<
  typeof F511_FEATURE_ID,
  typeof F511_STAGE,
  typeof F511_OPERATION_CODE,
  F511SolomonoffUniversalPriorWeightCalibratorConfig,
  F511SolomonoffUniversalPriorWeightCalibratorInput,
  F511SolomonoffUniversalPriorWeightCalibratorOutput
> {
  constructor(
    customConfig?: Partial<F511SolomonoffUniversalPriorWeightCalibratorConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F511_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "program_lengths_bits",
        "occam_razor_weights",
        "normalized_prior_probs",
        "shortest_program_id"
      ] as const,
      F511SolomonoffUniversalPriorWeightCalibratorValidationError
    );
  }
}

export function verifyF511Module(): {
  readonly featureId: typeof F511_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F511SolomonoffUniversalPriorWeightCalibratorService();
  const sampleInput: F511SolomonoffUniversalPriorWeightCalibratorInput = {
    requestId: "req_verify_f511",
    projectId: "proj_kosmora_f511",
    workspaceId: "ws_kosmora_f511",
    tenantId: "tenant_rlm_f511",
    actorId: "actor_verifier_f511",
    autonomyLevel: "A3",
    program_lengths_bits: "seed_f511_program_lengths_bits",
    occam_razor_weights: 42,
    normalized_prior_probs: true,
    shortest_program_id: "seed_f511_shortest_program_id",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F511" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F511" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_program_lengths_bits !== sampleInput.program_lengths_bits &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F511] Verification failed`);
  }

  return {
    featureId: F511_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
