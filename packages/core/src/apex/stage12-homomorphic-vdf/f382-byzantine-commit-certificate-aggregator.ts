/**
 * F382 (stage12-homomorphic-vdf): Агрегатор кворумных сертификатов фиксации состояния (2f + 1 Commit Certificate)
 * Сборка финального криптографического подтверждения блока после прохождения фаз Prepare и Commit
 * Operation Code: bft_commit_aggregator
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

export const F382_FEATURE_ID = "F382" as const;
export const F382_STAGE = "stage12-homomorphic-vdf" as const;
export const F382_OPERATION_CODE = "bft_commit_aggregator" as const;
export const F382_CONTRACT_VERSION = "2.0.0" as const;

export type F382ByzantineCommitCertificateAggregatorConfig = BaseFeatureConfig<
  typeof F382_FEATURE_ID,
  typeof F382_STAGE,
  typeof F382_OPERATION_CODE
>;

export interface F382ByzantineCommitCertificateAggregatorInput extends BaseFeatureInput {
  readonly block_digest: string | number | boolean | readonly string[];
  readonly signers_count: string | number | boolean | readonly string[];
  readonly quorum_threshold: string | number | boolean | readonly string[];
  readonly commit_certificate: string | number | boolean | readonly string[];
}

export interface F382ByzantineCommitCertificateAggregatorOutput {
  readonly featureId: typeof F382_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F382_OPERATION_CODE;
  readonly resolved_block_digest: unknown;
  readonly resolved_signers_count: unknown;
  readonly resolved_quorum_threshold: unknown;
  readonly resolved_commit_certificate: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F382_FEATURE_ID>;
}

export type F382ByzantineCommitCertificateAggregatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F382_FEATURE_ID
>;

export const DEFAULT_F382_CONFIG: F382ByzantineCommitCertificateAggregatorConfig = {
  featureId: F382_FEATURE_ID,
  stage: F382_STAGE,
  operationCode: F382_OPERATION_CODE,
  contractVersion: F382_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F382ByzantineCommitCertificateAggregatorValidationError extends Error {
  public readonly featureId = F382_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F382 Validation Error on '${field}']: ${message}`);
    this.name = "F382ByzantineCommitCertificateAggregatorValidationError";
    this.field = field;
  }
}

export function computeF382Digest(rawPayload: string): string {
  return `f382_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F382ByzantineCommitCertificateAggregatorService extends KosmoraFeatureAdapterBase<
  typeof F382_FEATURE_ID,
  typeof F382_STAGE,
  typeof F382_OPERATION_CODE,
  F382ByzantineCommitCertificateAggregatorConfig,
  F382ByzantineCommitCertificateAggregatorInput,
  F382ByzantineCommitCertificateAggregatorOutput
> {
  constructor(
    customConfig?: Partial<F382ByzantineCommitCertificateAggregatorConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F382_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["block_digest", "signers_count", "quorum_threshold", "commit_certificate"] as const,
      F382ByzantineCommitCertificateAggregatorValidationError
    );
  }
}

export function verifyF382Module(): {
  readonly featureId: typeof F382_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F382ByzantineCommitCertificateAggregatorService();
  const sampleInput: F382ByzantineCommitCertificateAggregatorInput = {
    requestId: "req_verify_f382",
    projectId: "proj_kosmora_f382",
    workspaceId: "ws_kosmora_f382",
    tenantId: "tenant_rlm_f382",
    actorId: "actor_verifier_f382",
    autonomyLevel: "A3",
    block_digest: "seed_f382_block_digest",
    signers_count: 42,
    quorum_threshold: true,
    commit_certificate: "seed_f382_commit_certificate",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F382" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F382" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_block_digest !== sampleInput.block_digest &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F382] Verification failed`);
  }

  return {
    featureId: F382_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
