/**
 * F381 (stage12-homomorphic-vdf): Генератор криптографических сертификатов наказания (Slashing Certificate) за эквивокацию
 * Формирование неопровержимого доказательства византийского поведения узла для исключения из кластера
 * Operation Code: bft_slashing_cert
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

export const F381_FEATURE_ID = "F381" as const;
export const F381_STAGE = "stage12-homomorphic-vdf" as const;
export const F381_OPERATION_CODE = "bft_slashing_cert" as const;
export const F381_CONTRACT_VERSION = "2.0.0" as const;

export type F381ByzantineSlashingCertificateGeneratorConfig = BaseFeatureConfig<
  typeof F381_FEATURE_ID,
  typeof F381_STAGE,
  typeof F381_OPERATION_CODE
>;

export interface F381ByzantineSlashingCertificateGeneratorInput extends BaseFeatureInput {
  readonly offending_validator: string | number | boolean | readonly string[];
  readonly conflicting_digests: string | number | boolean | readonly string[];
  readonly slashing_cert_sha256: string | number | boolean | readonly string[];
  readonly validator_evicted: string | number | boolean | readonly string[];
}

export interface F381ByzantineSlashingCertificateGeneratorOutput {
  readonly featureId: typeof F381_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F381_OPERATION_CODE;
  readonly resolved_offending_validator: unknown;
  readonly resolved_conflicting_digests: unknown;
  readonly resolved_slashing_cert_sha256: unknown;
  readonly resolved_validator_evicted: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F381_FEATURE_ID>;
}

export type F381ByzantineSlashingCertificateGeneratorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F381_FEATURE_ID
>;

export const DEFAULT_F381_CONFIG: F381ByzantineSlashingCertificateGeneratorConfig = {
  featureId: F381_FEATURE_ID,
  stage: F381_STAGE,
  operationCode: F381_OPERATION_CODE,
  contractVersion: F381_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F381ByzantineSlashingCertificateGeneratorValidationError extends Error {
  public readonly featureId = F381_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F381 Validation Error on '${field}']: ${message}`);
    this.name = "F381ByzantineSlashingCertificateGeneratorValidationError";
    this.field = field;
  }
}

export function computeF381Digest(rawPayload: string): string {
  return `f381_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F381ByzantineSlashingCertificateGeneratorService extends KosmoraFeatureAdapterBase<
  typeof F381_FEATURE_ID,
  typeof F381_STAGE,
  typeof F381_OPERATION_CODE,
  F381ByzantineSlashingCertificateGeneratorConfig,
  F381ByzantineSlashingCertificateGeneratorInput,
  F381ByzantineSlashingCertificateGeneratorOutput
> {
  constructor(
    customConfig?: Partial<F381ByzantineSlashingCertificateGeneratorConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F381_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      [
        "offending_validator",
        "conflicting_digests",
        "slashing_cert_sha256",
        "validator_evicted"
      ] as const,
      F381ByzantineSlashingCertificateGeneratorValidationError
    );
  }
}

export function verifyF381Module(): {
  readonly featureId: typeof F381_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F381ByzantineSlashingCertificateGeneratorService();
  const sampleInput: F381ByzantineSlashingCertificateGeneratorInput = {
    requestId: "req_verify_f381",
    projectId: "proj_kosmora_f381",
    workspaceId: "ws_kosmora_f381",
    tenantId: "tenant_rlm_f381",
    actorId: "actor_verifier_f381",
    autonomyLevel: "A3",
    offending_validator: "seed_f381_offending_validator",
    conflicting_digests: 42,
    slashing_cert_sha256: true,
    validator_evicted: "seed_f381_validator_evicted",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F381" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F381" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_offending_validator !== sampleInput.offending_validator &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F381] Verification failed`);
  }

  return {
    featureId: F381_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
