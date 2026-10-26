/**
 * F266 (stage9-quantum-zk): Координатор проактивного обновления долей без смены секрета
 * Перевыпуск долей хранителей при сохранении нулевого свободного члена полинома P(0)
 * Operation Code: shamir_proactive_refresh
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
import { Stage9QuantumZkKernel } from "./stage-kernel.js";

export const F266_FEATURE_ID = "F266" as const;
export const F266_STAGE = "stage9-quantum-zk" as const;
export const F266_OPERATION_CODE = "shamir_proactive_refresh" as const;
export const F266_CONTRACT_VERSION = "2.0.0" as const;

export type F266ShamirProactiveShareRefreshCoordinatorConfig = BaseFeatureConfig<
  typeof F266_FEATURE_ID,
  typeof F266_STAGE,
  typeof F266_OPERATION_CODE
>;

export interface F266ShamirProactiveShareRefreshCoordinatorInput extends BaseFeatureInput {
  readonly custodian_group: string | number | boolean | readonly string[];
  readonly refresh_epoch: string | number | boolean | readonly string[];
  readonly threshold_k: string | number | boolean | readonly string[];
  readonly zero_sum_poly_seed: string | number | boolean | readonly string[];
}

export interface F266ShamirProactiveShareRefreshCoordinatorOutput {
  readonly featureId: typeof F266_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F266_OPERATION_CODE;
  readonly resolved_custodian_group: unknown;
  readonly resolved_refresh_epoch: unknown;
  readonly resolved_threshold_k: unknown;
  readonly resolved_zero_sum_poly_seed: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F266_FEATURE_ID>;
}

export type F266ShamirProactiveShareRefreshCoordinatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F266_FEATURE_ID>;

export const DEFAULT_F266_CONFIG: F266ShamirProactiveShareRefreshCoordinatorConfig = {
  featureId: F266_FEATURE_ID,
  stage: F266_STAGE,
  operationCode: F266_OPERATION_CODE,
  contractVersion: F266_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F266ShamirProactiveShareRefreshCoordinatorValidationError extends Error {
  public readonly featureId = F266_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F266 Validation Error on '${field}']: ${message}`);
    this.name = "F266ShamirProactiveShareRefreshCoordinatorValidationError";
    this.field = field;
  }
}

export function computeF266Digest(rawPayload: string): string {
  return `f266_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F266ShamirProactiveShareRefreshCoordinatorService extends KosmoraFeatureAdapterBase<
  typeof F266_FEATURE_ID,
  typeof F266_STAGE,
  typeof F266_OPERATION_CODE,
  F266ShamirProactiveShareRefreshCoordinatorConfig,
  F266ShamirProactiveShareRefreshCoordinatorInput,
  F266ShamirProactiveShareRefreshCoordinatorOutput
> {
  constructor(customConfig?: Partial<F266ShamirProactiveShareRefreshCoordinatorConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F266_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["custodian_group", "refresh_epoch", "threshold_k", "zero_sum_poly_seed"] as const,
      F266ShamirProactiveShareRefreshCoordinatorValidationError
    );
  }
}

export function verifyF266Module(): {
  readonly featureId: typeof F266_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F266ShamirProactiveShareRefreshCoordinatorService();
  const sampleInput: F266ShamirProactiveShareRefreshCoordinatorInput = {
    requestId: "req_verify_f266",
    projectId: "proj_kosmora_f266",
    workspaceId: "ws_kosmora_f266",
    tenantId: "tenant_rlm_f266",
    actorId: "actor_verifier_f266",
    autonomyLevel: "A3",
    custodian_group: "seed_f266_custodian_group",
    refresh_epoch: 42,
    threshold_k: true,
    zero_sum_poly_seed: "seed_f266_zero_sum_poly_seed",
    metadata: { stage: "stage9-quantum-zk", featureId: "F266" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F266" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_custodian_group !== sampleInput.custodian_group &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F266] Verification failed`);
  }

  return {
    featureId: F266_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
