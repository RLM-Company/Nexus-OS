/**
 * F223 (stage7-formal-verification): Агрегатор формальных доказательств безопасности, CSP и детерминизма
 * Сборка единого манифеста верификации из результатов Model Checking, CSP, W3C Trace, Replay и Taint Analysis
 * Operation Code: multi_stage_formal_proof_aggregator
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

export const F223_FEATURE_ID = "F223" as const;
export const F223_STAGE = "stage7-formal-verification" as const;
export const F223_OPERATION_CODE = "multi_stage_formal_proof_aggregator" as const;
export const F223_CONTRACT_VERSION = "2.0.0" as const;

export type F223MultiStageFormalProofAggregatorConfig = BaseFeatureConfig<
  typeof F223_FEATURE_ID,
  typeof F223_STAGE,
  typeof F223_OPERATION_CODE
>;

export interface F223MultiStageFormalProofAggregatorInput extends BaseFeatureInput {
  readonly fsm_safe: string | number | boolean | readonly string[];
  readonly csp_feasible: string | number | boolean | readonly string[];
  readonly replay_verified: string | number | boolean | readonly string[];
  readonly taint_safe: string | number | boolean | readonly string[];
}

export interface F223MultiStageFormalProofAggregatorOutput {
  readonly featureId: typeof F223_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F223_OPERATION_CODE;
  readonly resolved_fsm_safe: unknown;
  readonly resolved_csp_feasible: unknown;
  readonly resolved_replay_verified: unknown;
  readonly resolved_taint_safe: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F223_FEATURE_ID>;
}

export type F223MultiStageFormalProofAggregatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F223_FEATURE_ID
>;

export const DEFAULT_F223_CONFIG: F223MultiStageFormalProofAggregatorConfig = {
  featureId: F223_FEATURE_ID,
  stage: F223_STAGE,
  operationCode: F223_OPERATION_CODE,
  contractVersion: F223_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F223MultiStageFormalProofAggregatorValidationError extends Error {
  public readonly featureId = F223_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F223 Validation Error on '${field}']: ${message}`);
    this.name = "F223MultiStageFormalProofAggregatorValidationError";
    this.field = field;
  }
}

export function computeF223Digest(rawPayload: string): string {
  return `f223_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F223MultiStageFormalProofAggregatorService extends KosmoraFeatureAdapterBase<
  typeof F223_FEATURE_ID,
  typeof F223_STAGE,
  typeof F223_OPERATION_CODE,
  F223MultiStageFormalProofAggregatorConfig,
  F223MultiStageFormalProofAggregatorInput,
  F223MultiStageFormalProofAggregatorOutput
> {
  constructor(
    customConfig?: Partial<F223MultiStageFormalProofAggregatorConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F223_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["fsm_safe", "csp_feasible", "replay_verified", "taint_safe"] as const,
      F223MultiStageFormalProofAggregatorValidationError
    );
  }
}

export function verifyF223Module(): {
  readonly featureId: typeof F223_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F223MultiStageFormalProofAggregatorService();
  const sampleInput: F223MultiStageFormalProofAggregatorInput = {
    requestId: "req_verify_f223",
    projectId: "proj_kosmora_f223",
    workspaceId: "ws_kosmora_f223",
    tenantId: "tenant_rlm_f223",
    actorId: "actor_verifier_f223",
    autonomyLevel: "A3",
    fsm_safe: "seed_f223_fsm_safe",
    csp_feasible: 42,
    replay_verified: true,
    taint_safe: "seed_f223_taint_safe",
    metadata: { stage: "stage7-formal-verification", featureId: "F223" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F223" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_fsm_safe !== sampleInput.fsm_safe &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F223] Verification failed`);
  }

  return {
    featureId: F223_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
