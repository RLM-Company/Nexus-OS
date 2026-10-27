/**
 * F290 (stage10-game-theory): Точный распределитель вектора Шепли (Exact Shapley Value Allocator)
 * Факториальный расчёт справедливого вклада каждого агента в общий результат многоагентного DAG
 * Operation Code: shapley_exact_allocate
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

export const F290_FEATURE_ID = "F290" as const;
export const F290_STAGE = "stage10-game-theory" as const;
export const F290_OPERATION_CODE = "shapley_exact_allocate" as const;
export const F290_CONTRACT_VERSION = "2.0.0" as const;

export type F290ShapleyExactFactorialValueAllocatorConfig = BaseFeatureConfig<
  typeof F290_FEATURE_ID,
  typeof F290_STAGE,
  typeof F290_OPERATION_CODE
>;

export interface F290ShapleyExactFactorialValueAllocatorInput extends BaseFeatureInput {
  readonly agent_list: string | number | boolean | readonly string[];
  readonly coalition_worth_map: string | number | boolean | readonly string[];
  readonly grand_coalition_total: string | number | boolean | readonly string[];
  readonly rounding_policy: string | number | boolean | readonly string[];
}

export interface F290ShapleyExactFactorialValueAllocatorOutput {
  readonly featureId: typeof F290_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F290_OPERATION_CODE;
  readonly resolved_agent_list: unknown;
  readonly resolved_coalition_worth_map: unknown;
  readonly resolved_grand_coalition_total: unknown;
  readonly resolved_rounding_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F290_FEATURE_ID>;
}

export type F290ShapleyExactFactorialValueAllocatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F290_FEATURE_ID
>;

export const DEFAULT_F290_CONFIG: F290ShapleyExactFactorialValueAllocatorConfig = {
  featureId: F290_FEATURE_ID,
  stage: F290_STAGE,
  operationCode: F290_OPERATION_CODE,
  contractVersion: F290_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F290ShapleyExactFactorialValueAllocatorValidationError extends Error {
  public readonly featureId = F290_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F290 Validation Error on '${field}']: ${message}`);
    this.name = "F290ShapleyExactFactorialValueAllocatorValidationError";
    this.field = field;
  }
}

export function computeF290Digest(rawPayload: string): string {
  return `f290_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F290ShapleyExactFactorialValueAllocatorService extends KosmoraFeatureAdapterBase<
  typeof F290_FEATURE_ID,
  typeof F290_STAGE,
  typeof F290_OPERATION_CODE,
  F290ShapleyExactFactorialValueAllocatorConfig,
  F290ShapleyExactFactorialValueAllocatorInput,
  F290ShapleyExactFactorialValueAllocatorOutput
> {
  constructor(
    customConfig?: Partial<F290ShapleyExactFactorialValueAllocatorConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F290_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["agent_list", "coalition_worth_map", "grand_coalition_total", "rounding_policy"] as const,
      F290ShapleyExactFactorialValueAllocatorValidationError
    );
  }
}

export function verifyF290Module(): {
  readonly featureId: typeof F290_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F290ShapleyExactFactorialValueAllocatorService();
  const sampleInput: F290ShapleyExactFactorialValueAllocatorInput = {
    requestId: "req_verify_f290",
    projectId: "proj_kosmora_f290",
    workspaceId: "ws_kosmora_f290",
    tenantId: "tenant_rlm_f290",
    actorId: "actor_verifier_f290",
    autonomyLevel: "A3",
    agent_list: "seed_f290_agent_list",
    coalition_worth_map: 42,
    grand_coalition_total: true,
    rounding_policy: "seed_f290_rounding_policy",
    metadata: { stage: "stage10-game-theory", featureId: "F290" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F290" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_list !== sampleInput.agent_list &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F290] Verification failed`);
  }

  return {
    featureId: F290_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
