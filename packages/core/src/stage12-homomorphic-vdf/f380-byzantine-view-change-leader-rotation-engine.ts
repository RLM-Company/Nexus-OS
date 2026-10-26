/**
 * F380 (stage12-homomorphic-vdf): Протокол смены вида (View-Change) при зависании или компрометации текущего лидера
 * Детерминированный переход к следующему лидеру v+1 по кворуму из 2f + 1 подписанных жалоб
 * Operation Code: bft_view_change
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

export const F380_FEATURE_ID = "F380" as const;
export const F380_STAGE = "stage12-homomorphic-vdf" as const;
export const F380_OPERATION_CODE = "bft_view_change" as const;
export const F380_CONTRACT_VERSION = "2.0.0" as const;

export type F380ByzantineViewChangeLeaderRotationEngineConfig = BaseFeatureConfig<
  typeof F380_FEATURE_ID,
  typeof F380_STAGE,
  typeof F380_OPERATION_CODE
>;

export interface F380ByzantineViewChangeLeaderRotationEngineInput extends BaseFeatureInput {
  readonly previous_view: string | number | boolean | readonly string[];
  readonly next_view: string | number | boolean | readonly string[];
  readonly new_leader_id: string | number | boolean | readonly string[];
  readonly quorum_cert_hash: string | number | boolean | readonly string[];
}

export interface F380ByzantineViewChangeLeaderRotationEngineOutput {
  readonly featureId: typeof F380_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F380_OPERATION_CODE;
  readonly resolved_previous_view: unknown;
  readonly resolved_next_view: unknown;
  readonly resolved_new_leader_id: unknown;
  readonly resolved_quorum_cert_hash: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F380_FEATURE_ID>;
}

export type F380ByzantineViewChangeLeaderRotationEngineTelemetrySnapshot = BaseFeatureTelemetry<typeof F380_FEATURE_ID>;

export const DEFAULT_F380_CONFIG: F380ByzantineViewChangeLeaderRotationEngineConfig = {
  featureId: F380_FEATURE_ID,
  stage: F380_STAGE,
  operationCode: F380_OPERATION_CODE,
  contractVersion: F380_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F380ByzantineViewChangeLeaderRotationEngineValidationError extends Error {
  public readonly featureId = F380_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F380 Validation Error on '${field}']: ${message}`);
    this.name = "F380ByzantineViewChangeLeaderRotationEngineValidationError";
    this.field = field;
  }
}

export function computeF380Digest(rawPayload: string): string {
  return `f380_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F380ByzantineViewChangeLeaderRotationEngineService extends KosmoraFeatureAdapterBase<
  typeof F380_FEATURE_ID,
  typeof F380_STAGE,
  typeof F380_OPERATION_CODE,
  F380ByzantineViewChangeLeaderRotationEngineConfig,
  F380ByzantineViewChangeLeaderRotationEngineInput,
  F380ByzantineViewChangeLeaderRotationEngineOutput
> {
  constructor(customConfig?: Partial<F380ByzantineViewChangeLeaderRotationEngineConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F380_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["previous_view", "next_view", "new_leader_id", "quorum_cert_hash"] as const,
      F380ByzantineViewChangeLeaderRotationEngineValidationError
    );
  }
}

export function verifyF380Module(): {
  readonly featureId: typeof F380_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F380ByzantineViewChangeLeaderRotationEngineService();
  const sampleInput: F380ByzantineViewChangeLeaderRotationEngineInput = {
    requestId: "req_verify_f380",
    projectId: "proj_kosmora_f380",
    workspaceId: "ws_kosmora_f380",
    tenantId: "tenant_rlm_f380",
    actorId: "actor_verifier_f380",
    autonomyLevel: "A3",
    previous_view: "seed_f380_previous_view",
    next_view: 42,
    new_leader_id: true,
    quorum_cert_hash: "seed_f380_quorum_cert_hash",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F380" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F380" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_previous_view !== sampleInput.previous_view &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F380] Verification failed`);
  }

  return {
    featureId: F380_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
