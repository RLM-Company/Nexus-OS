/**
 * F315 (stage10-game-theory): Верификатор отсутствия блокирующих пар (Blocking Pair Stability Prover)
 * Математическая проверка того, что ни одна пара (агент, задача) не предпочитает друг друга своим текущим назначениям
 * Operation Code: galeshapley_blocking_verify
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

export const F315_FEATURE_ID = "F315" as const;
export const F315_STAGE = "stage10-game-theory" as const;
export const F315_OPERATION_CODE = "galeshapley_blocking_verify" as const;
export const F315_CONTRACT_VERSION = "2.0.0" as const;

export type F315GaleShapleyBlockingPairStabilityVerifierConfig = BaseFeatureConfig<
  typeof F315_FEATURE_ID,
  typeof F315_STAGE,
  typeof F315_OPERATION_CODE
>;

export interface F315GaleShapleyBlockingPairStabilityVerifierInput extends BaseFeatureInput {
  readonly matched_pairs: string | number | boolean | readonly string[];
  readonly agent_prefs: string | number | boolean | readonly string[];
  readonly task_prefs: string | number | boolean | readonly string[];
  readonly stability_policy: string | number | boolean | readonly string[];
}

export interface F315GaleShapleyBlockingPairStabilityVerifierOutput {
  readonly featureId: typeof F315_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F315_OPERATION_CODE;
  readonly resolved_matched_pairs: unknown;
  readonly resolved_agent_prefs: unknown;
  readonly resolved_task_prefs: unknown;
  readonly resolved_stability_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F315_FEATURE_ID>;
}

export type F315GaleShapleyBlockingPairStabilityVerifierTelemetrySnapshot = BaseFeatureTelemetry<typeof F315_FEATURE_ID>;

export const DEFAULT_F315_CONFIG: F315GaleShapleyBlockingPairStabilityVerifierConfig = {
  featureId: F315_FEATURE_ID,
  stage: F315_STAGE,
  operationCode: F315_OPERATION_CODE,
  contractVersion: F315_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F315GaleShapleyBlockingPairStabilityVerifierValidationError extends Error {
  public readonly featureId = F315_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F315 Validation Error on '${field}']: ${message}`);
    this.name = "F315GaleShapleyBlockingPairStabilityVerifierValidationError";
    this.field = field;
  }
}

export function computeF315Digest(rawPayload: string): string {
  return `f315_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F315GaleShapleyBlockingPairStabilityVerifierService extends KosmoraFeatureAdapterBase<
  typeof F315_FEATURE_ID,
  typeof F315_STAGE,
  typeof F315_OPERATION_CODE,
  F315GaleShapleyBlockingPairStabilityVerifierConfig,
  F315GaleShapleyBlockingPairStabilityVerifierInput,
  F315GaleShapleyBlockingPairStabilityVerifierOutput
> {
  constructor(customConfig?: Partial<F315GaleShapleyBlockingPairStabilityVerifierConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F315_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["matched_pairs", "agent_prefs", "task_prefs", "stability_policy"] as const,
      F315GaleShapleyBlockingPairStabilityVerifierValidationError
    );
  }
}

export function verifyF315Module(): {
  readonly featureId: typeof F315_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F315GaleShapleyBlockingPairStabilityVerifierService();
  const sampleInput: F315GaleShapleyBlockingPairStabilityVerifierInput = {
    requestId: "req_verify_f315",
    projectId: "proj_kosmora_f315",
    workspaceId: "ws_kosmora_f315",
    tenantId: "tenant_rlm_f315",
    actorId: "actor_verifier_f315",
    autonomyLevel: "A3",
    matched_pairs: "seed_f315_matched_pairs",
    agent_prefs: 42,
    task_prefs: true,
    stability_policy: "seed_f315_stability_policy",
    metadata: { stage: "stage10-game-theory", featureId: "F315" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F315" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_matched_pairs !== sampleInput.matched_pairs &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F315] Verification failed`);
  }

  return {
    featureId: F315_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
