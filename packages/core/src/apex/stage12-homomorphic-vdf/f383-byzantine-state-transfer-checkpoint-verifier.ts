/**
 * F383 (stage12-homomorphic-vdf): Верификатор контрольных точек синхронизации отстающих реплик (BFT State Transfer)
 * Безопасная докачка состояния узлом при наличии 2f + 1 совпадающих подписей над дайджестом снапшота
 * Operation Code: bft_checkpoint_verifier
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
import { Stage12HomomorphicVdfKernel } from "./stage-kernel.js";

export const F383_FEATURE_ID = "F383" as const;
export const F383_STAGE = "stage12-homomorphic-vdf" as const;
export const F383_OPERATION_CODE = "bft_checkpoint_verifier" as const;
export const F383_CONTRACT_VERSION = "2.0.0" as const;

export type F383ByzantineStateTransferCheckpointVerifierConfig = BaseFeatureConfig<
  typeof F383_FEATURE_ID,
  typeof F383_STAGE,
  typeof F383_OPERATION_CODE
>;

export interface F383ByzantineStateTransferCheckpointVerifierInput extends BaseFeatureInput {
  readonly checkpoint_seq: string | number | boolean | readonly string[];
  readonly state_digest: string | number | boolean | readonly string[];
  readonly verified_signatures: string | number | boolean | readonly string[];
  readonly sync_completed: string | number | boolean | readonly string[];
}

export interface F383ByzantineStateTransferCheckpointVerifierOutput {
  readonly featureId: typeof F383_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F383_OPERATION_CODE;
  readonly resolved_checkpoint_seq: unknown;
  readonly resolved_state_digest: unknown;
  readonly resolved_verified_signatures: unknown;
  readonly resolved_sync_completed: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F383_FEATURE_ID>;
}

export type F383ByzantineStateTransferCheckpointVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F383_FEATURE_ID
>;

export const DEFAULT_F383_CONFIG: F383ByzantineStateTransferCheckpointVerifierConfig = {
  featureId: F383_FEATURE_ID,
  stage: F383_STAGE,
  operationCode: F383_OPERATION_CODE,
  contractVersion: F383_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F383ByzantineStateTransferCheckpointVerifierValidationError extends Error {
  public readonly featureId = F383_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F383 Validation Error on '${field}']: ${message}`);
    this.name = "F383ByzantineStateTransferCheckpointVerifierValidationError";
    this.field = field;
  }
}

export function computeF383Digest(rawPayload: string): string {
  return `f383_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F383ByzantineStateTransferCheckpointVerifierService extends KosmoraFeatureAdapterBase<
  typeof F383_FEATURE_ID,
  typeof F383_STAGE,
  typeof F383_OPERATION_CODE,
  F383ByzantineStateTransferCheckpointVerifierConfig,
  F383ByzantineStateTransferCheckpointVerifierInput,
  F383ByzantineStateTransferCheckpointVerifierOutput
> {
  constructor(
    customConfig?: Partial<F383ByzantineStateTransferCheckpointVerifierConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F383_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["checkpoint_seq", "state_digest", "verified_signatures", "sync_completed"] as const,
      F383ByzantineStateTransferCheckpointVerifierValidationError
    );
  }
}

export function verifyF383Module(): {
  readonly featureId: typeof F383_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F383ByzantineStateTransferCheckpointVerifierService();
  const sampleInput: F383ByzantineStateTransferCheckpointVerifierInput = {
    requestId: "req_verify_f383",
    projectId: "proj_kosmora_f383",
    workspaceId: "ws_kosmora_f383",
    tenantId: "tenant_rlm_f383",
    actorId: "actor_verifier_f383",
    autonomyLevel: "A3",
    checkpoint_seq: "seed_f383_checkpoint_seq",
    state_digest: 42,
    verified_signatures: true,
    sync_completed: "seed_f383_sync_completed",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F383" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F383" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_checkpoint_seq !== sampleInput.checkpoint_seq &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F383] Verification failed`);
  }

  return {
    featureId: F383_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
