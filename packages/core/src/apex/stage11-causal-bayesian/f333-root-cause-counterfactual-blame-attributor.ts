/**
 * F333 (stage11-causal-bayesian): Контрфактический атрибутор первопричины сбоя (Counterfactual Root-Cause Locator)
 * Проверка того, исчезла ли бы ошибка пайплайна при замене конкретного узла на эталонный
 * Operation Code: cf_blame_attributor
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

export const F333_FEATURE_ID = "F333" as const;
export const F333_STAGE = "stage11-causal-bayesian" as const;
export const F333_OPERATION_CODE = "cf_blame_attributor" as const;
export const F333_CONTRACT_VERSION = "2.0.0" as const;

export type F333RootCauseCounterfactualBlameAttributorConfig = BaseFeatureConfig<
  typeof F333_FEATURE_ID,
  typeof F333_STAGE,
  typeof F333_OPERATION_CODE
>;

export interface F333RootCauseCounterfactualBlameAttributorInput extends BaseFeatureInput {
  readonly failed_node_id: string | number | boolean | readonly string[];
  readonly counterfactual_fixed: string | number | boolean | readonly string[];
  readonly necessity_prob: string | number | boolean | readonly string[];
  readonly blame_rank: string | number | boolean | readonly string[];
}

export interface F333RootCauseCounterfactualBlameAttributorOutput {
  readonly featureId: typeof F333_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F333_OPERATION_CODE;
  readonly resolved_failed_node_id: unknown;
  readonly resolved_counterfactual_fixed: unknown;
  readonly resolved_necessity_prob: unknown;
  readonly resolved_blame_rank: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F333_FEATURE_ID>;
}

export type F333RootCauseCounterfactualBlameAttributorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F333_FEATURE_ID
>;

export const DEFAULT_F333_CONFIG: F333RootCauseCounterfactualBlameAttributorConfig = {
  featureId: F333_FEATURE_ID,
  stage: F333_STAGE,
  operationCode: F333_OPERATION_CODE,
  contractVersion: F333_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F333RootCauseCounterfactualBlameAttributorValidationError extends Error {
  public readonly featureId = F333_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F333 Validation Error on '${field}']: ${message}`);
    this.name = "F333RootCauseCounterfactualBlameAttributorValidationError";
    this.field = field;
  }
}

export function computeF333Digest(rawPayload: string): string {
  return `f333_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F333RootCauseCounterfactualBlameAttributorService extends KosmoraFeatureAdapterBase<
  typeof F333_FEATURE_ID,
  typeof F333_STAGE,
  typeof F333_OPERATION_CODE,
  F333RootCauseCounterfactualBlameAttributorConfig,
  F333RootCauseCounterfactualBlameAttributorInput,
  F333RootCauseCounterfactualBlameAttributorOutput
> {
  constructor(
    customConfig?: Partial<F333RootCauseCounterfactualBlameAttributorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F333_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["failed_node_id", "counterfactual_fixed", "necessity_prob", "blame_rank"] as const,
      F333RootCauseCounterfactualBlameAttributorValidationError
    );
  }
}

export function verifyF333Module(): {
  readonly featureId: typeof F333_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F333RootCauseCounterfactualBlameAttributorService();
  const sampleInput: F333RootCauseCounterfactualBlameAttributorInput = {
    requestId: "req_verify_f333",
    projectId: "proj_kosmora_f333",
    workspaceId: "ws_kosmora_f333",
    tenantId: "tenant_rlm_f333",
    actorId: "actor_verifier_f333",
    autonomyLevel: "A3",
    failed_node_id: "seed_f333_failed_node_id",
    counterfactual_fixed: 42,
    necessity_prob: true,
    blame_rank: "seed_f333_blame_rank",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F333" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F333" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_failed_node_id !== sampleInput.failed_node_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F333] Verification failed`);
  }

  return {
    featureId: F333_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
