/**
 * F314 (stage10-game-theory): Алгоритм отложенного согласия Гейла-Шепли (Deferred Acceptance Engine)
 * Пошаговое формирование устойчивого паросочетания между агентами и вычислительными слотами
 * Operation Code: galeshapley_deferred_propose
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

export const F314_FEATURE_ID = "F314" as const;
export const F314_STAGE = "stage10-game-theory" as const;
export const F314_OPERATION_CODE = "galeshapley_deferred_propose" as const;
export const F314_CONTRACT_VERSION = "2.0.0" as const;

export type F314GaleShapleyDeferredAcceptanceProposerConfig = BaseFeatureConfig<
  typeof F314_FEATURE_ID,
  typeof F314_STAGE,
  typeof F314_OPERATION_CODE
>;

export interface F314GaleShapleyDeferredAcceptanceProposerInput extends BaseFeatureInput {
  readonly unmatched_agents: string | number | boolean | readonly string[];
  readonly next_proposal_index: string | number | boolean | readonly string[];
  readonly task_rankings: string | number | boolean | readonly string[];
  readonly round_limit: string | number | boolean | readonly string[];
}

export interface F314GaleShapleyDeferredAcceptanceProposerOutput {
  readonly featureId: typeof F314_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F314_OPERATION_CODE;
  readonly resolved_unmatched_agents: unknown;
  readonly resolved_next_proposal_index: unknown;
  readonly resolved_task_rankings: unknown;
  readonly resolved_round_limit: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F314_FEATURE_ID>;
}

export type F314GaleShapleyDeferredAcceptanceProposerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F314_FEATURE_ID
>;

export const DEFAULT_F314_CONFIG: F314GaleShapleyDeferredAcceptanceProposerConfig = {
  featureId: F314_FEATURE_ID,
  stage: F314_STAGE,
  operationCode: F314_OPERATION_CODE,
  contractVersion: F314_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F314GaleShapleyDeferredAcceptanceProposerValidationError extends Error {
  public readonly featureId = F314_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F314 Validation Error on '${field}']: ${message}`);
    this.name = "F314GaleShapleyDeferredAcceptanceProposerValidationError";
    this.field = field;
  }
}

export function computeF314Digest(rawPayload: string): string {
  return `f314_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F314GaleShapleyDeferredAcceptanceProposerService extends KosmoraFeatureAdapterBase<
  typeof F314_FEATURE_ID,
  typeof F314_STAGE,
  typeof F314_OPERATION_CODE,
  F314GaleShapleyDeferredAcceptanceProposerConfig,
  F314GaleShapleyDeferredAcceptanceProposerInput,
  F314GaleShapleyDeferredAcceptanceProposerOutput
> {
  constructor(
    customConfig?: Partial<F314GaleShapleyDeferredAcceptanceProposerConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F314_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["unmatched_agents", "next_proposal_index", "task_rankings", "round_limit"] as const,
      F314GaleShapleyDeferredAcceptanceProposerValidationError
    );
  }
}

export function verifyF314Module(): {
  readonly featureId: typeof F314_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F314GaleShapleyDeferredAcceptanceProposerService();
  const sampleInput: F314GaleShapleyDeferredAcceptanceProposerInput = {
    requestId: "req_verify_f314",
    projectId: "proj_kosmora_f314",
    workspaceId: "ws_kosmora_f314",
    tenantId: "tenant_rlm_f314",
    actorId: "actor_verifier_f314",
    autonomyLevel: "A3",
    unmatched_agents: "seed_f314_unmatched_agents",
    next_proposal_index: 42,
    task_rankings: true,
    round_limit: "seed_f314_round_limit",
    metadata: { stage: "stage10-game-theory", featureId: "F314" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F314" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_unmatched_agents !== sampleInput.unmatched_agents &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F314] Verification failed`);
  }

  return {
    featureId: F314_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
