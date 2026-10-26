/**
 * F272 (stage9-quantum-zk): Привязчик ZK-вызовов с защитой от атак повтора (Replay Guard)
 * Включение идентификатора утверждения и одноразового зерна в хеш Фиата-Шамира H(g||y||t||stmt)
 * Operation Code: zk_challenge_binder
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
import { Stage9QuantumZkKernel } from "./stage-kernel.js";

export const F272_FEATURE_ID = "F272" as const;
export const F272_STAGE = "stage9-quantum-zk" as const;
export const F272_OPERATION_CODE = "zk_challenge_binder" as const;
export const F272_CONTRACT_VERSION = "2.0.0" as const;

export type F272ZkReplayResistantChallengeBinderConfig = BaseFeatureConfig<
  typeof F272_FEATURE_ID,
  typeof F272_STAGE,
  typeof F272_OPERATION_CODE
>;

export interface F272ZkReplayResistantChallengeBinderInput extends BaseFeatureInput {
  readonly session_challenge: string | number | boolean | readonly string[];
  readonly epoch_timestamp: string | number | boolean | readonly string[];
  readonly prover_commitment: string | number | boolean | readonly string[];
  readonly nonce_window: string | number | boolean | readonly string[];
}

export interface F272ZkReplayResistantChallengeBinderOutput {
  readonly featureId: typeof F272_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F272_OPERATION_CODE;
  readonly resolved_session_challenge: unknown;
  readonly resolved_epoch_timestamp: unknown;
  readonly resolved_prover_commitment: unknown;
  readonly resolved_nonce_window: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F272_FEATURE_ID>;
}

export type F272ZkReplayResistantChallengeBinderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F272_FEATURE_ID
>;

export const DEFAULT_F272_CONFIG: F272ZkReplayResistantChallengeBinderConfig = {
  featureId: F272_FEATURE_ID,
  stage: F272_STAGE,
  operationCode: F272_OPERATION_CODE,
  contractVersion: F272_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F272ZkReplayResistantChallengeBinderValidationError extends Error {
  public readonly featureId = F272_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F272 Validation Error on '${field}']: ${message}`);
    this.name = "F272ZkReplayResistantChallengeBinderValidationError";
    this.field = field;
  }
}

export function computeF272Digest(rawPayload: string): string {
  return `f272_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F272ZkReplayResistantChallengeBinderService extends KosmoraFeatureAdapterBase<
  typeof F272_FEATURE_ID,
  typeof F272_STAGE,
  typeof F272_OPERATION_CODE,
  F272ZkReplayResistantChallengeBinderConfig,
  F272ZkReplayResistantChallengeBinderInput,
  F272ZkReplayResistantChallengeBinderOutput
> {
  constructor(
    customConfig?: Partial<F272ZkReplayResistantChallengeBinderConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F272_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["session_challenge", "epoch_timestamp", "prover_commitment", "nonce_window"] as const,
      F272ZkReplayResistantChallengeBinderValidationError
    );
  }
}

export function verifyF272Module(): {
  readonly featureId: typeof F272_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F272ZkReplayResistantChallengeBinderService();
  const sampleInput: F272ZkReplayResistantChallengeBinderInput = {
    requestId: "req_verify_f272",
    projectId: "proj_kosmora_f272",
    workspaceId: "ws_kosmora_f272",
    tenantId: "tenant_rlm_f272",
    actorId: "actor_verifier_f272",
    autonomyLevel: "A3",
    session_challenge: "seed_f272_session_challenge",
    epoch_timestamp: 42,
    prover_commitment: true,
    nonce_window: "seed_f272_nonce_window",
    metadata: { stage: "stage9-quantum-zk", featureId: "F272" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F272" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_session_challenge !== sampleInput.session_challenge &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F272] Verification failed`);
  }

  return {
    featureId: F272_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
