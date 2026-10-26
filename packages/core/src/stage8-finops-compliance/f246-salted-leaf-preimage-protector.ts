/**
 * F246 (stage8-finops-compliance): Защита листьев дерева Меркла от словарного перебора (Preimage Salting)
 * Индивидуальное криптографическое солирование каждого атрибута перед хешированием листа
 * Operation Code: salted_leaf_preimage_protector
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
import { Stage8FinOpsKernel } from "./stage-kernel.js";

export const F246_FEATURE_ID = "F246" as const;
export const F246_STAGE = "stage8-finops-compliance" as const;
export const F246_OPERATION_CODE = "salted_leaf_preimage_protector" as const;
export const F246_CONTRACT_VERSION = "2.0.0" as const;

export type F246SaltedLeafPreimageProtectorConfig = BaseFeatureConfig<
  typeof F246_FEATURE_ID,
  typeof F246_STAGE,
  typeof F246_OPERATION_CODE
>;

export interface F246SaltedLeafPreimageProtectorInput extends BaseFeatureInput {
  readonly leaf_hash: string | number | boolean | readonly string[];
  readonly merkle_root: string | number | boolean | readonly string[];
  readonly proof_valid: string | number | boolean | readonly string[];
  readonly preimage_protected: string | number | boolean | readonly string[];
}

export interface F246SaltedLeafPreimageProtectorOutput {
  readonly featureId: typeof F246_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F246_OPERATION_CODE;
  readonly resolved_leaf_hash: unknown;
  readonly resolved_merkle_root: unknown;
  readonly resolved_proof_valid: unknown;
  readonly resolved_preimage_protected: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F246_FEATURE_ID>;
}

export type F246SaltedLeafPreimageProtectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F246_FEATURE_ID>;

export const DEFAULT_F246_CONFIG: F246SaltedLeafPreimageProtectorConfig = {
  featureId: F246_FEATURE_ID,
  stage: F246_STAGE,
  operationCode: F246_OPERATION_CODE,
  contractVersion: F246_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F246SaltedLeafPreimageProtectorValidationError extends Error {
  public readonly featureId = F246_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F246 Validation Error on '${field}']: ${message}`);
    this.name = "F246SaltedLeafPreimageProtectorValidationError";
    this.field = field;
  }
}

export function computeF246Digest(rawPayload: string): string {
  return `f246_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F246SaltedLeafPreimageProtectorService extends KosmoraFeatureAdapterBase<
  typeof F246_FEATURE_ID,
  typeof F246_STAGE,
  typeof F246_OPERATION_CODE,
  F246SaltedLeafPreimageProtectorConfig,
  F246SaltedLeafPreimageProtectorInput,
  F246SaltedLeafPreimageProtectorOutput
> {
  constructor(customConfig?: Partial<F246SaltedLeafPreimageProtectorConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F246_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["leaf_hash", "merkle_root", "proof_valid", "preimage_protected"] as const,
      F246SaltedLeafPreimageProtectorValidationError
    );
  }
}

export function verifyF246Module(): {
  readonly featureId: typeof F246_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F246SaltedLeafPreimageProtectorService();
  const sampleInput: F246SaltedLeafPreimageProtectorInput = {
    requestId: "req_verify_f246",
    projectId: "proj_kosmora_f246",
    workspaceId: "ws_kosmora_f246",
    tenantId: "tenant_rlm_f246",
    actorId: "actor_verifier_f246",
    autonomyLevel: "A3",
    leaf_hash: "seed_f246_leaf_hash",
    merkle_root: 42,
    proof_valid: true,
    preimage_protected: "seed_f246_preimage_protected",
    metadata: { stage: "stage8-finops-compliance", featureId: "F246" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F246" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_leaf_hash !== sampleInput.leaf_hash &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F246] Verification failed`);
  }

  return {
    featureId: F246_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
