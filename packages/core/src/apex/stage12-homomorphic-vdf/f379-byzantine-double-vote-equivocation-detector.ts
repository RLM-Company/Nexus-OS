/**
 * F379 (stage12-homomorphic-vdf): Детектор двойного голосования византийских валидаторов (Equivocation Slasher)
 * Обнаружение узлов, подписавших два противоречащих дайджеста блока в одном номере вида (view)
 * Operation Code: bft_equivocation_detector
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

export const F379_FEATURE_ID = "F379" as const;
export const F379_STAGE = "stage12-homomorphic-vdf" as const;
export const F379_OPERATION_CODE = "bft_equivocation_detector" as const;
export const F379_CONTRACT_VERSION = "2.0.0" as const;

export type F379ByzantineDoubleVoteEquivocationDetectorConfig = BaseFeatureConfig<
  typeof F379_FEATURE_ID,
  typeof F379_STAGE,
  typeof F379_OPERATION_CODE
>;

export interface F379ByzantineDoubleVoteEquivocationDetectorInput extends BaseFeatureInput {
  readonly inspected_votes_count: string | number | boolean | readonly string[];
  readonly equivocating_validators: string | number | boolean | readonly string[];
  readonly slashing_triggered: string | number | boolean | readonly string[];
  readonly evidence_hash: string | number | boolean | readonly string[];
}

export interface F379ByzantineDoubleVoteEquivocationDetectorOutput {
  readonly featureId: typeof F379_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F379_OPERATION_CODE;
  readonly resolved_inspected_votes_count: unknown;
  readonly resolved_equivocating_validators: unknown;
  readonly resolved_slashing_triggered: unknown;
  readonly resolved_evidence_hash: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F379_FEATURE_ID>;
}

export type F379ByzantineDoubleVoteEquivocationDetectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F379_FEATURE_ID
>;

export const DEFAULT_F379_CONFIG: F379ByzantineDoubleVoteEquivocationDetectorConfig = {
  featureId: F379_FEATURE_ID,
  stage: F379_STAGE,
  operationCode: F379_OPERATION_CODE,
  contractVersion: F379_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F379ByzantineDoubleVoteEquivocationDetectorValidationError extends Error {
  public readonly featureId = F379_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F379 Validation Error on '${field}']: ${message}`);
    this.name = "F379ByzantineDoubleVoteEquivocationDetectorValidationError";
    this.field = field;
  }
}

export function computeF379Digest(rawPayload: string): string {
  return `f379_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F379ByzantineDoubleVoteEquivocationDetectorService extends KosmoraFeatureAdapterBase<
  typeof F379_FEATURE_ID,
  typeof F379_STAGE,
  typeof F379_OPERATION_CODE,
  F379ByzantineDoubleVoteEquivocationDetectorConfig,
  F379ByzantineDoubleVoteEquivocationDetectorInput,
  F379ByzantineDoubleVoteEquivocationDetectorOutput
> {
  constructor(
    customConfig?: Partial<F379ByzantineDoubleVoteEquivocationDetectorConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F379_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      [
        "inspected_votes_count",
        "equivocating_validators",
        "slashing_triggered",
        "evidence_hash"
      ] as const,
      F379ByzantineDoubleVoteEquivocationDetectorValidationError
    );
  }
}

export function verifyF379Module(): {
  readonly featureId: typeof F379_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F379ByzantineDoubleVoteEquivocationDetectorService();
  const sampleInput: F379ByzantineDoubleVoteEquivocationDetectorInput = {
    requestId: "req_verify_f379",
    projectId: "proj_kosmora_f379",
    workspaceId: "ws_kosmora_f379",
    tenantId: "tenant_rlm_f379",
    actorId: "actor_verifier_f379",
    autonomyLevel: "A3",
    inspected_votes_count: "seed_f379_inspected_votes_count",
    equivocating_validators: 42,
    slashing_triggered: true,
    evidence_hash: "seed_f379_evidence_hash",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F379" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F379" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_inspected_votes_count !== sampleInput.inspected_votes_count &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F379] Verification failed`);
  }

  return {
    featureId: F379_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
