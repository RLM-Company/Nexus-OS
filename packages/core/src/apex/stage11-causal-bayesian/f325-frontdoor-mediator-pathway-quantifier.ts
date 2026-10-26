/**
 * F325 (stage11-causal-bayesian): Анализатор опосредованных путей воздействия (Frontdoor Mediator Quantifier)
 * Декомпозиция прямого и косвенного причинного влияния через промежуточные узлы-медиаторы
 * Operation Code: frontdoor_mediator_quantifier
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

export const F325_FEATURE_ID = "F325" as const;
export const F325_STAGE = "stage11-causal-bayesian" as const;
export const F325_OPERATION_CODE = "frontdoor_mediator_quantifier" as const;
export const F325_CONTRACT_VERSION = "2.0.0" as const;

export type F325FrontdoorMediatorPathwayQuantifierConfig = BaseFeatureConfig<
  typeof F325_FEATURE_ID,
  typeof F325_STAGE,
  typeof F325_OPERATION_CODE
>;

export interface F325FrontdoorMediatorPathwayQuantifierInput extends BaseFeatureInput {
  readonly source_treatment: string | number | boolean | readonly string[];
  readonly mediator_node: string | number | boolean | readonly string[];
  readonly outcome_node: string | number | boolean | readonly string[];
  readonly mediated_share_pct: string | number | boolean | readonly string[];
}

export interface F325FrontdoorMediatorPathwayQuantifierOutput {
  readonly featureId: typeof F325_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F325_OPERATION_CODE;
  readonly resolved_source_treatment: unknown;
  readonly resolved_mediator_node: unknown;
  readonly resolved_outcome_node: unknown;
  readonly resolved_mediated_share_pct: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F325_FEATURE_ID>;
}

export type F325FrontdoorMediatorPathwayQuantifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F325_FEATURE_ID
>;

export const DEFAULT_F325_CONFIG: F325FrontdoorMediatorPathwayQuantifierConfig = {
  featureId: F325_FEATURE_ID,
  stage: F325_STAGE,
  operationCode: F325_OPERATION_CODE,
  contractVersion: F325_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F325FrontdoorMediatorPathwayQuantifierValidationError extends Error {
  public readonly featureId = F325_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F325 Validation Error on '${field}']: ${message}`);
    this.name = "F325FrontdoorMediatorPathwayQuantifierValidationError";
    this.field = field;
  }
}

export function computeF325Digest(rawPayload: string): string {
  return `f325_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F325FrontdoorMediatorPathwayQuantifierService extends KosmoraFeatureAdapterBase<
  typeof F325_FEATURE_ID,
  typeof F325_STAGE,
  typeof F325_OPERATION_CODE,
  F325FrontdoorMediatorPathwayQuantifierConfig,
  F325FrontdoorMediatorPathwayQuantifierInput,
  F325FrontdoorMediatorPathwayQuantifierOutput
> {
  constructor(
    customConfig?: Partial<F325FrontdoorMediatorPathwayQuantifierConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F325_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["source_treatment", "mediator_node", "outcome_node", "mediated_share_pct"] as const,
      F325FrontdoorMediatorPathwayQuantifierValidationError
    );
  }
}

export function verifyF325Module(): {
  readonly featureId: typeof F325_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F325FrontdoorMediatorPathwayQuantifierService();
  const sampleInput: F325FrontdoorMediatorPathwayQuantifierInput = {
    requestId: "req_verify_f325",
    projectId: "proj_kosmora_f325",
    workspaceId: "ws_kosmora_f325",
    tenantId: "tenant_rlm_f325",
    actorId: "actor_verifier_f325",
    autonomyLevel: "A3",
    source_treatment: "seed_f325_source_treatment",
    mediator_node: 42,
    outcome_node: true,
    mediated_share_pct: "seed_f325_mediated_share_pct",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F325" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F325" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_treatment !== sampleInput.source_treatment &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F325] Verification failed`);
  }

  return {
    featureId: F325_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
