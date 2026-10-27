/**
 * F244 (stage8-finops-compliance): Генератор доказательств включения (Selective Disclosure Proof) без раскрытия соседних полей
 * Предоставление внешнему аудитору математического доказательства одного факта при сохранении в тайне остальных
 * Operation Code: selective_disclosure_inclusion_prover
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

export const F244_FEATURE_ID = "F244" as const;
export const F244_STAGE = "stage8-finops-compliance" as const;
export const F244_OPERATION_CODE = "selective_disclosure_inclusion_prover" as const;
export const F244_CONTRACT_VERSION = "2.0.0" as const;

export type F244SelectiveDisclosureInclusionProverConfig = BaseFeatureConfig<
  typeof F244_FEATURE_ID,
  typeof F244_STAGE,
  typeof F244_OPERATION_CODE
>;

export interface F244SelectiveDisclosureInclusionProverInput extends BaseFeatureInput {
  readonly document_id: string | number | boolean | readonly string[];
  readonly revealed_claim_key: string | number | boolean | readonly string[];
  readonly siblings_count: string | number | boolean | readonly string[];
  readonly merkle_root: string | number | boolean | readonly string[];
}

export interface F244SelectiveDisclosureInclusionProverOutput {
  readonly featureId: typeof F244_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F244_OPERATION_CODE;
  readonly resolved_document_id: unknown;
  readonly resolved_revealed_claim_key: unknown;
  readonly resolved_siblings_count: unknown;
  readonly resolved_merkle_root: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F244_FEATURE_ID>;
}

export type F244SelectiveDisclosureInclusionProverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F244_FEATURE_ID
>;

export const DEFAULT_F244_CONFIG: F244SelectiveDisclosureInclusionProverConfig = {
  featureId: F244_FEATURE_ID,
  stage: F244_STAGE,
  operationCode: F244_OPERATION_CODE,
  contractVersion: F244_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F244SelectiveDisclosureInclusionProverValidationError extends Error {
  public readonly featureId = F244_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F244 Validation Error on '${field}']: ${message}`);
    this.name = "F244SelectiveDisclosureInclusionProverValidationError";
    this.field = field;
  }
}

export function computeF244Digest(rawPayload: string): string {
  return `f244_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F244SelectiveDisclosureInclusionProverService extends KosmoraFeatureAdapterBase<
  typeof F244_FEATURE_ID,
  typeof F244_STAGE,
  typeof F244_OPERATION_CODE,
  F244SelectiveDisclosureInclusionProverConfig,
  F244SelectiveDisclosureInclusionProverInput,
  F244SelectiveDisclosureInclusionProverOutput
> {
  constructor(
    customConfig?: Partial<F244SelectiveDisclosureInclusionProverConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F244_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["document_id", "revealed_claim_key", "siblings_count", "merkle_root"] as const,
      F244SelectiveDisclosureInclusionProverValidationError
    );
  }
}

export function verifyF244Module(): {
  readonly featureId: typeof F244_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F244SelectiveDisclosureInclusionProverService();
  const sampleInput: F244SelectiveDisclosureInclusionProverInput = {
    requestId: "req_verify_f244",
    projectId: "proj_kosmora_f244",
    workspaceId: "ws_kosmora_f244",
    tenantId: "tenant_rlm_f244",
    actorId: "actor_verifier_f244",
    autonomyLevel: "A3",
    document_id: "seed_f244_document_id",
    revealed_claim_key: 42,
    siblings_count: true,
    merkle_root: "seed_f244_merkle_root",
    metadata: { stage: "stage8-finops-compliance", featureId: "F244" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F244" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F244] Verification failed`);
  }

  return {
    featureId: F244_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
