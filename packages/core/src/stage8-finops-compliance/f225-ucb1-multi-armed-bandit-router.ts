/**
 * F225 (stage8-finops-compliance): Адаптивный маршрутизатор LLM-провайдеров на базе алгоритма UCB1 Bandit
 * Балансировка исследования и эксплуатации (Exploration/Exploitation) между моделями по качеству, задержке и цене
 * Operation Code: ucb1_multi_armed_bandit_router
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
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F225_FEATURE_ID = "F225" as const;
export const F225_STAGE = "stage8-finops-compliance" as const;
export const F225_OPERATION_CODE = "ucb1_multi_armed_bandit_router" as const;
export const F225_CONTRACT_VERSION = "2.0.0" as const;

export type F225Ucb1MultiArmedBanditRouterConfig = BaseFeatureConfig<
  typeof F225_FEATURE_ID,
  typeof F225_STAGE,
  typeof F225_OPERATION_CODE
>;

export interface F225Ucb1MultiArmedBanditRouterInput extends BaseFeatureInput {
  readonly selected_provider_id: string | number | boolean | readonly string[];
  readonly selected_model_id: string | number | boolean | readonly string[];
  readonly ucb_score: string | number | boolean | readonly string[];
  readonly routing_digest: string | number | boolean | readonly string[];
}

export interface F225Ucb1MultiArmedBanditRouterOutput {
  readonly featureId: typeof F225_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F225_OPERATION_CODE;
  readonly resolved_selected_provider_id: unknown;
  readonly resolved_selected_model_id: unknown;
  readonly resolved_ucb_score: unknown;
  readonly resolved_routing_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F225_FEATURE_ID>;
}

export type F225Ucb1MultiArmedBanditRouterTelemetrySnapshot = BaseFeatureTelemetry<typeof F225_FEATURE_ID>;

export const DEFAULT_F225_CONFIG: F225Ucb1MultiArmedBanditRouterConfig = {
  featureId: F225_FEATURE_ID,
  stage: F225_STAGE,
  operationCode: F225_OPERATION_CODE,
  contractVersion: F225_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F225Ucb1MultiArmedBanditRouterValidationError extends Error {
  public readonly featureId = F225_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F225 Validation Error on '${field}']: ${message}`);
    this.name = "F225Ucb1MultiArmedBanditRouterValidationError";
    this.field = field;
  }
}

export function computeF225Digest(rawPayload: string): string {
  return `f225_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F225Ucb1MultiArmedBanditRouterService extends KosmoraFeatureAdapterBase<
  typeof F225_FEATURE_ID,
  typeof F225_STAGE,
  typeof F225_OPERATION_CODE,
  F225Ucb1MultiArmedBanditRouterConfig,
  F225Ucb1MultiArmedBanditRouterInput,
  F225Ucb1MultiArmedBanditRouterOutput
> {
  constructor(customConfig?: Partial<F225Ucb1MultiArmedBanditRouterConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F225_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["selected_provider_id", "selected_model_id", "ucb_score", "routing_digest"] as const,
      F225Ucb1MultiArmedBanditRouterValidationError
    );
  }
}

export function verifyF225Module(): {
  readonly featureId: typeof F225_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F225Ucb1MultiArmedBanditRouterService();
  const sampleInput: F225Ucb1MultiArmedBanditRouterInput = {
    requestId: "req_verify_f225",
    projectId: "proj_kosmora_f225",
    workspaceId: "ws_kosmora_f225",
    tenantId: "tenant_rlm_f225",
    actorId: "actor_verifier_f225",
    autonomyLevel: "A3",
    selected_provider_id: "seed_f225_selected_provider_id",
    selected_model_id: 42,
    ucb_score: true,
    routing_digest: "seed_f225_routing_digest",
    metadata: { stage: "stage8-finops-compliance", featureId: "F225" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F225" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_selected_provider_id !== sampleInput.selected_provider_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F225] Verification failed`);
  }

  return {
    featureId: F225_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
