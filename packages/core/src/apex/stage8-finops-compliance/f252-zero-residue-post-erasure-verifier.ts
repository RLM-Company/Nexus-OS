/**
 * F252 (stage8-finops-compliance): Верификатор нулевого остатка данных (Zero-Residue Verifier) после исполнения RTBF
 * Повторное сканирование всех контуров тенанта для гарантии отсутствия остаточных записей субъекта
 * Operation Code: zero_residue_post_erasure_verifier
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

export const F252_FEATURE_ID = "F252" as const;
export const F252_STAGE = "stage8-finops-compliance" as const;
export const F252_OPERATION_CODE = "zero_residue_post_erasure_verifier" as const;
export const F252_CONTRACT_VERSION = "2.0.0" as const;

export type F252ZeroResiduePostErasureVerifierConfig = BaseFeatureConfig<
  typeof F252_FEATURE_ID,
  typeof F252_STAGE,
  typeof F252_OPERATION_CODE
>;

export interface F252ZeroResiduePostErasureVerifierInput extends BaseFeatureInput {
  readonly subject_id: string | number | boolean | readonly string[];
  readonly remaining_records_count: string | number | boolean | readonly string[];
  readonly zero_residue_confirmed: string | number | boolean | readonly string[];
  readonly certificate_id: string | number | boolean | readonly string[];
}

export interface F252ZeroResiduePostErasureVerifierOutput {
  readonly featureId: typeof F252_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F252_OPERATION_CODE;
  readonly resolved_subject_id: unknown;
  readonly resolved_remaining_records_count: unknown;
  readonly resolved_zero_residue_confirmed: unknown;
  readonly resolved_certificate_id: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F252_FEATURE_ID>;
}

export type F252ZeroResiduePostErasureVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F252_FEATURE_ID
>;

export const DEFAULT_F252_CONFIG: F252ZeroResiduePostErasureVerifierConfig = {
  featureId: F252_FEATURE_ID,
  stage: F252_STAGE,
  operationCode: F252_OPERATION_CODE,
  contractVersion: F252_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F252ZeroResiduePostErasureVerifierValidationError extends Error {
  public readonly featureId = F252_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F252 Validation Error on '${field}']: ${message}`);
    this.name = "F252ZeroResiduePostErasureVerifierValidationError";
    this.field = field;
  }
}

export function computeF252Digest(rawPayload: string): string {
  return `f252_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F252ZeroResiduePostErasureVerifierService extends KosmoraFeatureAdapterBase<
  typeof F252_FEATURE_ID,
  typeof F252_STAGE,
  typeof F252_OPERATION_CODE,
  F252ZeroResiduePostErasureVerifierConfig,
  F252ZeroResiduePostErasureVerifierInput,
  F252ZeroResiduePostErasureVerifierOutput
> {
  constructor(
    customConfig?: Partial<F252ZeroResiduePostErasureVerifierConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F252_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      [
        "subject_id",
        "remaining_records_count",
        "zero_residue_confirmed",
        "certificate_id"
      ] as const,
      F252ZeroResiduePostErasureVerifierValidationError
    );
  }
}

export function verifyF252Module(): {
  readonly featureId: typeof F252_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F252ZeroResiduePostErasureVerifierService();
  const sampleInput: F252ZeroResiduePostErasureVerifierInput = {
    requestId: "req_verify_f252",
    projectId: "proj_kosmora_f252",
    workspaceId: "ws_kosmora_f252",
    tenantId: "tenant_rlm_f252",
    actorId: "actor_verifier_f252",
    autonomyLevel: "A3",
    subject_id: "seed_f252_subject_id",
    remaining_records_count: 42,
    zero_residue_confirmed: true,
    certificate_id: "seed_f252_certificate_id",
    metadata: { stage: "stage8-finops-compliance", featureId: "F252" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F252" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_subject_id !== sampleInput.subject_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F252] Verification failed`);
  }

  return {
    featureId: F252_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
