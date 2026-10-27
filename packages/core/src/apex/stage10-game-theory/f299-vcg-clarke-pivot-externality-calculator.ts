/**
 * F299 (stage10-game-theory): Вычислитель экстерналий правила ведущего элемента Кларка (Clarke Pivot Rule)
 * Расчёт разницы благосостояния системы с участием агента и без него для честного ценообразования
 * Operation Code: vcg_clarke_pivot
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

export const F299_FEATURE_ID = "F299" as const;
export const F299_STAGE = "stage10-game-theory" as const;
export const F299_OPERATION_CODE = "vcg_clarke_pivot" as const;
export const F299_CONTRACT_VERSION = "2.0.0" as const;

export type F299VcgClarkePivotExternalityCalculatorConfig = BaseFeatureConfig<
  typeof F299_FEATURE_ID,
  typeof F299_STAGE,
  typeof F299_OPERATION_CODE
>;

export interface F299VcgClarkePivotExternalityCalculatorInput extends BaseFeatureInput {
  readonly excluded_agent_id: string | number | boolean | readonly string[];
  readonly remaining_agents: string | number | boolean | readonly string[];
  readonly optimal_with_agent_cost: string | number | boolean | readonly string[];
  readonly counterfactual_cost: string | number | boolean | readonly string[];
}

export interface F299VcgClarkePivotExternalityCalculatorOutput {
  readonly featureId: typeof F299_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F299_OPERATION_CODE;
  readonly resolved_excluded_agent_id: unknown;
  readonly resolved_remaining_agents: unknown;
  readonly resolved_optimal_with_agent_cost: unknown;
  readonly resolved_counterfactual_cost: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F299_FEATURE_ID>;
}

export type F299VcgClarkePivotExternalityCalculatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F299_FEATURE_ID
>;

export const DEFAULT_F299_CONFIG: F299VcgClarkePivotExternalityCalculatorConfig = {
  featureId: F299_FEATURE_ID,
  stage: F299_STAGE,
  operationCode: F299_OPERATION_CODE,
  contractVersion: F299_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F299VcgClarkePivotExternalityCalculatorValidationError extends Error {
  public readonly featureId = F299_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F299 Validation Error on '${field}']: ${message}`);
    this.name = "F299VcgClarkePivotExternalityCalculatorValidationError";
    this.field = field;
  }
}

export function computeF299Digest(rawPayload: string): string {
  return `f299_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F299VcgClarkePivotExternalityCalculatorService extends KosmoraFeatureAdapterBase<
  typeof F299_FEATURE_ID,
  typeof F299_STAGE,
  typeof F299_OPERATION_CODE,
  F299VcgClarkePivotExternalityCalculatorConfig,
  F299VcgClarkePivotExternalityCalculatorInput,
  F299VcgClarkePivotExternalityCalculatorOutput
> {
  constructor(
    customConfig?: Partial<F299VcgClarkePivotExternalityCalculatorConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F299_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      [
        "excluded_agent_id",
        "remaining_agents",
        "optimal_with_agent_cost",
        "counterfactual_cost"
      ] as const,
      F299VcgClarkePivotExternalityCalculatorValidationError
    );
  }
}

export function verifyF299Module(): {
  readonly featureId: typeof F299_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F299VcgClarkePivotExternalityCalculatorService();
  const sampleInput: F299VcgClarkePivotExternalityCalculatorInput = {
    requestId: "req_verify_f299",
    projectId: "proj_kosmora_f299",
    workspaceId: "ws_kosmora_f299",
    tenantId: "tenant_rlm_f299",
    actorId: "actor_verifier_f299",
    autonomyLevel: "A3",
    excluded_agent_id: "seed_f299_excluded_agent_id",
    remaining_agents: 42,
    optimal_with_agent_cost: true,
    counterfactual_cost: "seed_f299_counterfactual_cost",
    metadata: { stage: "stage10-game-theory", featureId: "F299" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F299" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_excluded_agent_id !== sampleInput.excluded_agent_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F299] Verification failed`);
  }

  return {
    featureId: F299_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
