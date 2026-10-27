/**
 * F251 (stage8-finops-compliance): Генератор юридически значимых сертификатов об удалении персональных данных
 * Выпуск неизменяемого документа с хешем уничтоженных идентификаторов и подписью комплаенс-контура
 * Operation Code: signed_erasure_certificate_generator
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

export const F251_FEATURE_ID = "F251" as const;
export const F251_STAGE = "stage8-finops-compliance" as const;
export const F251_OPERATION_CODE = "signed_erasure_certificate_generator" as const;
export const F251_CONTRACT_VERSION = "2.0.0" as const;

export type F251SignedErasureCertificateGeneratorConfig = BaseFeatureConfig<
  typeof F251_FEATURE_ID,
  typeof F251_STAGE,
  typeof F251_OPERATION_CODE
>;

export interface F251SignedErasureCertificateGeneratorInput extends BaseFeatureInput {
  readonly certificate_id: string | number | boolean | readonly string[];
  readonly subject_id: string | number | boolean | readonly string[];
  readonly purged_stores: string | number | boolean | readonly string[];
  readonly signature_sha256: string | number | boolean | readonly string[];
}

export interface F251SignedErasureCertificateGeneratorOutput {
  readonly featureId: typeof F251_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F251_OPERATION_CODE;
  readonly resolved_certificate_id: unknown;
  readonly resolved_subject_id: unknown;
  readonly resolved_purged_stores: unknown;
  readonly resolved_signature_sha256: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F251_FEATURE_ID>;
}

export type F251SignedErasureCertificateGeneratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F251_FEATURE_ID
>;

export const DEFAULT_F251_CONFIG: F251SignedErasureCertificateGeneratorConfig = {
  featureId: F251_FEATURE_ID,
  stage: F251_STAGE,
  operationCode: F251_OPERATION_CODE,
  contractVersion: F251_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F251SignedErasureCertificateGeneratorValidationError extends Error {
  public readonly featureId = F251_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F251 Validation Error on '${field}']: ${message}`);
    this.name = "F251SignedErasureCertificateGeneratorValidationError";
    this.field = field;
  }
}

export function computeF251Digest(rawPayload: string): string {
  return `f251_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F251SignedErasureCertificateGeneratorService extends KosmoraFeatureAdapterBase<
  typeof F251_FEATURE_ID,
  typeof F251_STAGE,
  typeof F251_OPERATION_CODE,
  F251SignedErasureCertificateGeneratorConfig,
  F251SignedErasureCertificateGeneratorInput,
  F251SignedErasureCertificateGeneratorOutput
> {
  constructor(
    customConfig?: Partial<F251SignedErasureCertificateGeneratorConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F251_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["certificate_id", "subject_id", "purged_stores", "signature_sha256"] as const,
      F251SignedErasureCertificateGeneratorValidationError
    );
  }
}

export function verifyF251Module(): {
  readonly featureId: typeof F251_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F251SignedErasureCertificateGeneratorService();
  const sampleInput: F251SignedErasureCertificateGeneratorInput = {
    requestId: "req_verify_f251",
    projectId: "proj_kosmora_f251",
    workspaceId: "ws_kosmora_f251",
    tenantId: "tenant_rlm_f251",
    actorId: "actor_verifier_f251",
    autonomyLevel: "A3",
    certificate_id: "seed_f251_certificate_id",
    subject_id: 42,
    purged_stores: true,
    signature_sha256: "seed_f251_signature_sha256",
    metadata: { stage: "stage8-finops-compliance", featureId: "F251" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F251" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_certificate_id !== sampleInput.certificate_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F251] Verification failed`);
  }

  return {
    featureId: F251_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
