/**
 * F365 (stage12-homomorphic-vdf): Генератор неманипулируемого маяка случайности (Unbiasable Randomness Beacon)
 * Использование выхода VDF для честной жеребьёвки лидеров и аудиторов без возможности подбора зерна
 * Operation Code: vdf_randomness_beacon
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage12HomomorphicVdfKernel } from "./stage-kernel.js";

export const F365_FEATURE_ID = "F365" as const;
export const F365_STAGE = "stage12-homomorphic-vdf" as const;
export const F365_OPERATION_CODE = "vdf_randomness_beacon" as const;
export const F365_CONTRACT_VERSION = "2.0.0" as const;

export type F365VdfUnbiasableRandomnessBeaconExtractorConfig = BaseFeatureConfig<
  typeof F365_FEATURE_ID,
  typeof F365_STAGE,
  typeof F365_OPERATION_CODE
>;

export interface F365VdfUnbiasableRandomnessBeaconExtractorInput extends BaseFeatureInput {
  readonly epoch_id: string | number | boolean | readonly string[];
  readonly vdf_output_y: string | number | boolean | readonly string[];
  readonly beacon_sha256: string | number | boolean | readonly string[];
  readonly unbiasable_verified: string | number | boolean | readonly string[];
}

export interface F365VdfUnbiasableRandomnessBeaconExtractorOutput {
  readonly featureId: typeof F365_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F365_OPERATION_CODE;
  readonly resolved_epoch_id: unknown;
  readonly resolved_vdf_output_y: unknown;
  readonly resolved_beacon_sha256: unknown;
  readonly resolved_unbiasable_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F365_FEATURE_ID>;
}

export type F365VdfUnbiasableRandomnessBeaconExtractorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F365_FEATURE_ID
>;

export const DEFAULT_F365_CONFIG: F365VdfUnbiasableRandomnessBeaconExtractorConfig = {
  featureId: F365_FEATURE_ID,
  stage: F365_STAGE,
  operationCode: F365_OPERATION_CODE,
  contractVersion: F365_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F365VdfUnbiasableRandomnessBeaconExtractorValidationError extends Error {
  public readonly featureId = F365_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F365 Validation Error on '${field}']: ${message}`);
    this.name = "F365VdfUnbiasableRandomnessBeaconExtractorValidationError";
    this.field = field;
  }
}

export function computeF365Digest(rawPayload: string): string {
  return `f365_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F365VdfUnbiasableRandomnessBeaconExtractorService extends KosmoraFeatureAdapterBase<
  typeof F365_FEATURE_ID,
  typeof F365_STAGE,
  typeof F365_OPERATION_CODE,
  F365VdfUnbiasableRandomnessBeaconExtractorConfig,
  F365VdfUnbiasableRandomnessBeaconExtractorInput,
  F365VdfUnbiasableRandomnessBeaconExtractorOutput
> {
  constructor(
    customConfig?: Partial<F365VdfUnbiasableRandomnessBeaconExtractorConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F365_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["epoch_id", "vdf_output_y", "beacon_sha256", "unbiasable_verified"] as const,
      F365VdfUnbiasableRandomnessBeaconExtractorValidationError
    );
  }
}

export function verifyF365Module(): {
  readonly featureId: typeof F365_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F365VdfUnbiasableRandomnessBeaconExtractorService();
  const sampleInput: F365VdfUnbiasableRandomnessBeaconExtractorInput = {
    requestId: "req_verify_f365",
    projectId: "proj_kosmora_f365",
    workspaceId: "ws_kosmora_f365",
    tenantId: "tenant_rlm_f365",
    actorId: "actor_verifier_f365",
    autonomyLevel: "A3",
    epoch_id: "seed_f365_epoch_id",
    vdf_output_y: 42,
    beacon_sha256: true,
    unbiasable_verified: "seed_f365_unbiasable_verified",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F365" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F365" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_epoch_id !== sampleInput.epoch_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F365] Verification failed`);
  }

  return {
    featureId: F365_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
