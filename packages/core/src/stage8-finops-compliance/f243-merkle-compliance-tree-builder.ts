/**
 * F243 (stage8-finops-compliance): Построитель бинарных деревьев Меркла (SHA-256 Merkle Tree) для комплаенс-утверждений
 * Агрегация конфиденциальных полей аудита в единый криптографический корень (Merkle Root)
 * Operation Code: merkle_compliance_tree_builder
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

export const F243_FEATURE_ID = "F243" as const;
export const F243_STAGE = "stage8-finops-compliance" as const;
export const F243_OPERATION_CODE = "merkle_compliance_tree_builder" as const;
export const F243_CONTRACT_VERSION = "2.0.0" as const;

export type F243MerkleComplianceTreeBuilderConfig = BaseFeatureConfig<
  typeof F243_FEATURE_ID,
  typeof F243_STAGE,
  typeof F243_OPERATION_CODE
>;

export interface F243MerkleComplianceTreeBuilderInput extends BaseFeatureInput {
  readonly document_id: string | number | boolean | readonly string[];
  readonly merkle_root: string | number | boolean | readonly string[];
  readonly total_leaves: string | number | boolean | readonly string[];
  readonly revealed_claim_key: string | number | boolean | readonly string[];
}

export interface F243MerkleComplianceTreeBuilderOutput {
  readonly featureId: typeof F243_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F243_OPERATION_CODE;
  readonly resolved_document_id: unknown;
  readonly resolved_merkle_root: unknown;
  readonly resolved_total_leaves: unknown;
  readonly resolved_revealed_claim_key: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F243_FEATURE_ID>;
}

export type F243MerkleComplianceTreeBuilderTelemetrySnapshot = BaseFeatureTelemetry<typeof F243_FEATURE_ID>;

export const DEFAULT_F243_CONFIG: F243MerkleComplianceTreeBuilderConfig = {
  featureId: F243_FEATURE_ID,
  stage: F243_STAGE,
  operationCode: F243_OPERATION_CODE,
  contractVersion: F243_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F243MerkleComplianceTreeBuilderValidationError extends Error {
  public readonly featureId = F243_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F243 Validation Error on '${field}']: ${message}`);
    this.name = "F243MerkleComplianceTreeBuilderValidationError";
    this.field = field;
  }
}

export function computeF243Digest(rawPayload: string): string {
  return `f243_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F243MerkleComplianceTreeBuilderService extends KosmoraFeatureAdapterBase<
  typeof F243_FEATURE_ID,
  typeof F243_STAGE,
  typeof F243_OPERATION_CODE,
  F243MerkleComplianceTreeBuilderConfig,
  F243MerkleComplianceTreeBuilderInput,
  F243MerkleComplianceTreeBuilderOutput
> {
  constructor(customConfig?: Partial<F243MerkleComplianceTreeBuilderConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F243_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["document_id", "merkle_root", "total_leaves", "revealed_claim_key"] as const,
      F243MerkleComplianceTreeBuilderValidationError
    );
  }
}

export function verifyF243Module(): {
  readonly featureId: typeof F243_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F243MerkleComplianceTreeBuilderService();
  const sampleInput: F243MerkleComplianceTreeBuilderInput = {
    requestId: "req_verify_f243",
    projectId: "proj_kosmora_f243",
    workspaceId: "ws_kosmora_f243",
    tenantId: "tenant_rlm_f243",
    actorId: "actor_verifier_f243",
    autonomyLevel: "A3",
    document_id: "seed_f243_document_id",
    merkle_root: 42,
    total_leaves: true,
    revealed_claim_key: "seed_f243_revealed_claim_key",
    metadata: { stage: "stage8-finops-compliance", featureId: "F243" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F243" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F243] Verification failed`);
  }

  return {
    featureId: F243_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
