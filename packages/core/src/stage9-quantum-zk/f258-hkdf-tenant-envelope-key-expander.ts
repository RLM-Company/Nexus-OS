/**
 * F258 (stage9-quantum-zk): Экспандер изолированных тенантных ключей HKDF
 * Детерминированный вывод дочерних ключей шифрования конвертов (DEK/KEK) с привязкой к tenant_id
 * Operation Code: hkdf_tenant_expand
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
import { Stage9QuantumZkKernel } from "./stage-kernel.js";

export const F258_FEATURE_ID = "F258" as const;
export const F258_STAGE = "stage9-quantum-zk" as const;
export const F258_OPERATION_CODE = "hkdf_tenant_expand" as const;
export const F258_CONTRACT_VERSION = "2.0.0" as const;

export type F258HkdfTenantEnvelopeKeyExpanderConfig = BaseFeatureConfig<
  typeof F258_FEATURE_ID,
  typeof F258_STAGE,
  typeof F258_OPERATION_CODE
>;

export interface F258HkdfTenantEnvelopeKeyExpanderInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly master_prk_hex: string | number | boolean | readonly string[];
  readonly envelope_purpose: string | number | boolean | readonly string[];
  readonly key_length_bytes: string | number | boolean | readonly string[];
}

export interface F258HkdfTenantEnvelopeKeyExpanderOutput {
  readonly featureId: typeof F258_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F258_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_master_prk_hex: unknown;
  readonly resolved_envelope_purpose: unknown;
  readonly resolved_key_length_bytes: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F258_FEATURE_ID>;
}

export type F258HkdfTenantEnvelopeKeyExpanderTelemetrySnapshot = BaseFeatureTelemetry<typeof F258_FEATURE_ID>;

export const DEFAULT_F258_CONFIG: F258HkdfTenantEnvelopeKeyExpanderConfig = {
  featureId: F258_FEATURE_ID,
  stage: F258_STAGE,
  operationCode: F258_OPERATION_CODE,
  contractVersion: F258_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F258HkdfTenantEnvelopeKeyExpanderValidationError extends Error {
  public readonly featureId = F258_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F258 Validation Error on '${field}']: ${message}`);
    this.name = "F258HkdfTenantEnvelopeKeyExpanderValidationError";
    this.field = field;
  }
}

export function computeF258Digest(rawPayload: string): string {
  return `f258_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F258HkdfTenantEnvelopeKeyExpanderService extends KosmoraFeatureAdapterBase<
  typeof F258_FEATURE_ID,
  typeof F258_STAGE,
  typeof F258_OPERATION_CODE,
  F258HkdfTenantEnvelopeKeyExpanderConfig,
  F258HkdfTenantEnvelopeKeyExpanderInput,
  F258HkdfTenantEnvelopeKeyExpanderOutput
> {
  constructor(customConfig?: Partial<F258HkdfTenantEnvelopeKeyExpanderConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F258_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["tenant_id", "master_prk_hex", "envelope_purpose", "key_length_bytes"] as const,
      F258HkdfTenantEnvelopeKeyExpanderValidationError
    );
  }
}

export function verifyF258Module(): {
  readonly featureId: typeof F258_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F258HkdfTenantEnvelopeKeyExpanderService();
  const sampleInput: F258HkdfTenantEnvelopeKeyExpanderInput = {
    requestId: "req_verify_f258",
    projectId: "proj_kosmora_f258",
    workspaceId: "ws_kosmora_f258",
    tenantId: "tenant_rlm_f258",
    actorId: "actor_verifier_f258",
    autonomyLevel: "A3",
    tenant_id: "seed_f258_tenant_id",
    master_prk_hex: 42,
    envelope_purpose: true,
    key_length_bytes: "seed_f258_key_length_bytes",
    metadata: { stage: "stage9-quantum-zk", featureId: "F258" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F258" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F258] Verification failed`);
  }

  return {
    featureId: F258_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
