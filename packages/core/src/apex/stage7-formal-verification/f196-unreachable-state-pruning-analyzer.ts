/**
 * F196 (stage7-formal-verification): Анализатор недостижимых ветвей и мёртвых состояний графа
 * Выявление изолированных узлов конечного автомата, в которые невозможно попасть из начального состояния
 * Operation Code: unreachable_state_pruning_analyzer
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F196_FEATURE_ID = "F196" as const;
export const F196_STAGE = "stage7-formal-verification" as const;
export const F196_OPERATION_CODE = "unreachable_state_pruning_analyzer" as const;
export const F196_CONTRACT_VERSION = "2.0.0" as const;

export type F196UnreachableStatePruningAnalyzerConfig = BaseFeatureConfig<
  typeof F196_FEATURE_ID,
  typeof F196_STAGE,
  typeof F196_OPERATION_CODE
>;

export interface F196UnreachableStatePruningAnalyzerInput extends BaseFeatureInput {
  readonly model_id: string | number | boolean | readonly string[];
  readonly unreachable_states_count: string | number | boolean | readonly string[];
  readonly reachable_ratio: string | number | boolean | readonly string[];
  readonly pruned_digest: string | number | boolean | readonly string[];
}

export interface F196UnreachableStatePruningAnalyzerOutput {
  readonly featureId: typeof F196_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F196_OPERATION_CODE;
  readonly resolved_model_id: unknown;
  readonly resolved_unreachable_states_count: unknown;
  readonly resolved_reachable_ratio: unknown;
  readonly resolved_pruned_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F196_FEATURE_ID>;
}

export type F196UnreachableStatePruningAnalyzerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F196_FEATURE_ID
>;

export const DEFAULT_F196_CONFIG: F196UnreachableStatePruningAnalyzerConfig = {
  featureId: F196_FEATURE_ID,
  stage: F196_STAGE,
  operationCode: F196_OPERATION_CODE,
  contractVersion: F196_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F196UnreachableStatePruningAnalyzerValidationError extends Error {
  public readonly featureId = F196_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F196 Validation Error on '${field}']: ${message}`);
    this.name = "F196UnreachableStatePruningAnalyzerValidationError";
    this.field = field;
  }
}

export function computeF196Digest(rawPayload: string): string {
  return `f196_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F196UnreachableStatePruningAnalyzerService extends KosmoraFeatureAdapterBase<
  typeof F196_FEATURE_ID,
  typeof F196_STAGE,
  typeof F196_OPERATION_CODE,
  F196UnreachableStatePruningAnalyzerConfig,
  F196UnreachableStatePruningAnalyzerInput,
  F196UnreachableStatePruningAnalyzerOutput
> {
  constructor(
    customConfig?: Partial<F196UnreachableStatePruningAnalyzerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F196_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["model_id", "unreachable_states_count", "reachable_ratio", "pruned_digest"] as const,
      F196UnreachableStatePruningAnalyzerValidationError
    );
  }
}

export function verifyF196Module(): {
  readonly featureId: typeof F196_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F196UnreachableStatePruningAnalyzerService();
  const sampleInput: F196UnreachableStatePruningAnalyzerInput = {
    requestId: "req_verify_f196",
    projectId: "proj_kosmora_f196",
    workspaceId: "ws_kosmora_f196",
    tenantId: "tenant_rlm_f196",
    actorId: "actor_verifier_f196",
    autonomyLevel: "A3",
    model_id: "seed_f196_model_id",
    unreachable_states_count: 42,
    reachable_ratio: true,
    pruned_digest: "seed_f196_pruned_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F196" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F196" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_model_id !== sampleInput.model_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F196] Verification failed`);
  }

  return {
    featureId: F196_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
