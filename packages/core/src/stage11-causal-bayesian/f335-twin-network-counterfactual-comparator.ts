/**
 * F335 (stage11-causal-bayesian): Компаратор двойных сетей (Twin-Network Graph) для параллельной оценки факта и контрфакта
 * Одновременное ведение реального и контрфактического мира с общими экзогенными переменными
 * Operation Code: cf_twin_comparator
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
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F335_FEATURE_ID = "F335" as const;
export const F335_STAGE = "stage11-causal-bayesian" as const;
export const F335_OPERATION_CODE = "cf_twin_comparator" as const;
export const F335_CONTRACT_VERSION = "2.0.0" as const;

export type F335TwinNetworkCounterfactualComparatorConfig = BaseFeatureConfig<
  typeof F335_FEATURE_ID,
  typeof F335_STAGE,
  typeof F335_OPERATION_CODE
>;

export interface F335TwinNetworkCounterfactualComparatorInput extends BaseFeatureInput {
  readonly factual_world_hash: string | number | boolean | readonly string[];
  readonly cf_world_hash: string | number | boolean | readonly string[];
  readonly shared_noise_vector: string | number | boolean | readonly string[];
  readonly divergence_metric: string | number | boolean | readonly string[];
}

export interface F335TwinNetworkCounterfactualComparatorOutput {
  readonly featureId: typeof F335_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F335_OPERATION_CODE;
  readonly resolved_factual_world_hash: unknown;
  readonly resolved_cf_world_hash: unknown;
  readonly resolved_shared_noise_vector: unknown;
  readonly resolved_divergence_metric: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F335_FEATURE_ID>;
}

export type F335TwinNetworkCounterfactualComparatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F335_FEATURE_ID>;

export const DEFAULT_F335_CONFIG: F335TwinNetworkCounterfactualComparatorConfig = {
  featureId: F335_FEATURE_ID,
  stage: F335_STAGE,
  operationCode: F335_OPERATION_CODE,
  contractVersion: F335_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F335TwinNetworkCounterfactualComparatorValidationError extends Error {
  public readonly featureId = F335_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F335 Validation Error on '${field}']: ${message}`);
    this.name = "F335TwinNetworkCounterfactualComparatorValidationError";
    this.field = field;
  }
}

export function computeF335Digest(rawPayload: string): string {
  return `f335_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F335TwinNetworkCounterfactualComparatorService extends KosmoraFeatureAdapterBase<
  typeof F335_FEATURE_ID,
  typeof F335_STAGE,
  typeof F335_OPERATION_CODE,
  F335TwinNetworkCounterfactualComparatorConfig,
  F335TwinNetworkCounterfactualComparatorInput,
  F335TwinNetworkCounterfactualComparatorOutput
> {
  constructor(customConfig?: Partial<F335TwinNetworkCounterfactualComparatorConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F335_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["factual_world_hash", "cf_world_hash", "shared_noise_vector", "divergence_metric"] as const,
      F335TwinNetworkCounterfactualComparatorValidationError
    );
  }
}

export function verifyF335Module(): {
  readonly featureId: typeof F335_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F335TwinNetworkCounterfactualComparatorService();
  const sampleInput: F335TwinNetworkCounterfactualComparatorInput = {
    requestId: "req_verify_f335",
    projectId: "proj_kosmora_f335",
    workspaceId: "ws_kosmora_f335",
    tenantId: "tenant_rlm_f335",
    actorId: "actor_verifier_f335",
    autonomyLevel: "A3",
    factual_world_hash: "seed_f335_factual_world_hash",
    cf_world_hash: 42,
    shared_noise_vector: true,
    divergence_metric: "seed_f335_divergence_metric",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F335" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F335" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_factual_world_hash !== sampleInput.factual_world_hash &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F335] Verification failed`);
  }

  return {
    featureId: F335_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
