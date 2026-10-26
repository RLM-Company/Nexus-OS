/**
 * F212 (stage7-formal-verification): Движок побитово-точного воспроизведения (Deterministic Time-Travel Replay)
 * Верификация совпадения всех входов и выходов при повторном прогоне сохранённой кассеты
 * Operation Code: bit_exact_deterministic_replayer
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

export const F212_FEATURE_ID = "F212" as const;
export const F212_STAGE = "stage7-formal-verification" as const;
export const F212_OPERATION_CODE = "bit_exact_deterministic_replayer" as const;
export const F212_CONTRACT_VERSION = "2.0.0" as const;

export type F212BitExactDeterministicReplayerConfig = BaseFeatureConfig<
  typeof F212_FEATURE_ID,
  typeof F212_STAGE,
  typeof F212_OPERATION_CODE
>;

export interface F212BitExactDeterministicReplayerInput extends BaseFeatureInput {
  readonly cassette_id: string | number | boolean | readonly string[];
  readonly replay_verified: string | number | boolean | readonly string[];
  readonly replayed_steps: string | number | boolean | readonly string[];
  readonly divergence_step: string | number | boolean | readonly string[];
}

export interface F212BitExactDeterministicReplayerOutput {
  readonly featureId: typeof F212_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F212_OPERATION_CODE;
  readonly resolved_cassette_id: unknown;
  readonly resolved_replay_verified: unknown;
  readonly resolved_replayed_steps: unknown;
  readonly resolved_divergence_step: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F212_FEATURE_ID>;
}

export type F212BitExactDeterministicReplayerTelemetrySnapshot = BaseFeatureTelemetry<typeof F212_FEATURE_ID>;

export const DEFAULT_F212_CONFIG: F212BitExactDeterministicReplayerConfig = {
  featureId: F212_FEATURE_ID,
  stage: F212_STAGE,
  operationCode: F212_OPERATION_CODE,
  contractVersion: F212_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F212BitExactDeterministicReplayerValidationError extends Error {
  public readonly featureId = F212_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F212 Validation Error on '${field}']: ${message}`);
    this.name = "F212BitExactDeterministicReplayerValidationError";
    this.field = field;
  }
}

export function computeF212Digest(rawPayload: string): string {
  return `f212_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F212BitExactDeterministicReplayerService extends KosmoraFeatureAdapterBase<
  typeof F212_FEATURE_ID,
  typeof F212_STAGE,
  typeof F212_OPERATION_CODE,
  F212BitExactDeterministicReplayerConfig,
  F212BitExactDeterministicReplayerInput,
  F212BitExactDeterministicReplayerOutput
> {
  constructor(customConfig?: Partial<F212BitExactDeterministicReplayerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F212_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["cassette_id", "replay_verified", "replayed_steps", "divergence_step"] as const,
      F212BitExactDeterministicReplayerValidationError
    );
  }
}

export function verifyF212Module(): {
  readonly featureId: typeof F212_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F212BitExactDeterministicReplayerService();
  const sampleInput: F212BitExactDeterministicReplayerInput = {
    requestId: "req_verify_f212",
    projectId: "proj_kosmora_f212",
    workspaceId: "ws_kosmora_f212",
    tenantId: "tenant_rlm_f212",
    actorId: "actor_verifier_f212",
    autonomyLevel: "A3",
    cassette_id: "seed_f212_cassette_id",
    replay_verified: 42,
    replayed_steps: true,
    divergence_step: "seed_f212_divergence_step",
    metadata: { stage: "stage7-formal-verification", featureId: "F212" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F212" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cassette_id !== sampleInput.cassette_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F212] Verification failed`);
  }

  return {
    featureId: F212_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
