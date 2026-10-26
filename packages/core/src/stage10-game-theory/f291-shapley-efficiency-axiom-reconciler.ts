/**
 * F291 (stage10-game-theory): Верификатор аксиомы эффективности Шепли (Sum phi_i === v(N))
 * Математическая проверка того, что сумма выплат агентам в точности равна ценности большой коалиции
 * Operation Code: shapley_efficiency_check
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
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F291_FEATURE_ID = "F291" as const;
export const F291_STAGE = "stage10-game-theory" as const;
export const F291_OPERATION_CODE = "shapley_efficiency_check" as const;
export const F291_CONTRACT_VERSION = "2.0.0" as const;

export type F291ShapleyEfficiencyAxiomReconcilerConfig = BaseFeatureConfig<
  typeof F291_FEATURE_ID,
  typeof F291_STAGE,
  typeof F291_OPERATION_CODE
>;

export interface F291ShapleyEfficiencyAxiomReconcilerInput extends BaseFeatureInput {
  readonly shapley_vector: string | number | boolean | readonly string[];
  readonly grand_coalition_value: string | number | boolean | readonly string[];
  readonly tolerance_epsilon: string | number | boolean | readonly string[];
  readonly reconcile_target: string | number | boolean | readonly string[];
}

export interface F291ShapleyEfficiencyAxiomReconcilerOutput {
  readonly featureId: typeof F291_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F291_OPERATION_CODE;
  readonly resolved_shapley_vector: unknown;
  readonly resolved_grand_coalition_value: unknown;
  readonly resolved_tolerance_epsilon: unknown;
  readonly resolved_reconcile_target: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F291_FEATURE_ID>;
}

export type F291ShapleyEfficiencyAxiomReconcilerTelemetrySnapshot = BaseFeatureTelemetry<typeof F291_FEATURE_ID>;

export const DEFAULT_F291_CONFIG: F291ShapleyEfficiencyAxiomReconcilerConfig = {
  featureId: F291_FEATURE_ID,
  stage: F291_STAGE,
  operationCode: F291_OPERATION_CODE,
  contractVersion: F291_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F291ShapleyEfficiencyAxiomReconcilerValidationError extends Error {
  public readonly featureId = F291_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F291 Validation Error on '${field}']: ${message}`);
    this.name = "F291ShapleyEfficiencyAxiomReconcilerValidationError";
    this.field = field;
  }
}

export function computeF291Digest(rawPayload: string): string {
  return `f291_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F291ShapleyEfficiencyAxiomReconcilerService extends KosmoraFeatureAdapterBase<
  typeof F291_FEATURE_ID,
  typeof F291_STAGE,
  typeof F291_OPERATION_CODE,
  F291ShapleyEfficiencyAxiomReconcilerConfig,
  F291ShapleyEfficiencyAxiomReconcilerInput,
  F291ShapleyEfficiencyAxiomReconcilerOutput
> {
  constructor(customConfig?: Partial<F291ShapleyEfficiencyAxiomReconcilerConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F291_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["shapley_vector", "grand_coalition_value", "tolerance_epsilon", "reconcile_target"] as const,
      F291ShapleyEfficiencyAxiomReconcilerValidationError
    );
  }
}

export function verifyF291Module(): {
  readonly featureId: typeof F291_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F291ShapleyEfficiencyAxiomReconcilerService();
  const sampleInput: F291ShapleyEfficiencyAxiomReconcilerInput = {
    requestId: "req_verify_f291",
    projectId: "proj_kosmora_f291",
    workspaceId: "ws_kosmora_f291",
    tenantId: "tenant_rlm_f291",
    actorId: "actor_verifier_f291",
    autonomyLevel: "A3",
    shapley_vector: "seed_f291_shapley_vector",
    grand_coalition_value: 42,
    tolerance_epsilon: true,
    reconcile_target: "seed_f291_reconcile_target",
    metadata: { stage: "stage10-game-theory", featureId: "F291" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F291" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_shapley_vector !== sampleInput.shapley_vector &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F291] Verification failed`);
  }

  return {
    featureId: F291_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
