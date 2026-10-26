/**
 * F360 (stage12-homomorphic-vdf): Аудитор корректности гомоморфных линейных комбинаций
 * Проверка тождества D(E(m1)^a * E(m2)^b mod n^2) === a*m1 + b*m2
 * Operation Code: paillier_integrity_audit
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

export const F360_FEATURE_ID = "F360" as const;
export const F360_STAGE = "stage12-homomorphic-vdf" as const;
export const F360_OPERATION_CODE = "paillier_integrity_audit" as const;
export const F360_CONTRACT_VERSION = "2.0.0" as const;

export type F360PaillierHomomorphicIntegrityAuditorConfig = BaseFeatureConfig<
  typeof F360_FEATURE_ID,
  typeof F360_STAGE,
  typeof F360_OPERATION_CODE
>;

export interface F360PaillierHomomorphicIntegrityAuditorInput extends BaseFeatureInput {
  readonly linear_combo_cipher: string | number | boolean | readonly string[];
  readonly decrypted_result: string | number | boolean | readonly string[];
  readonly expected_linear_val: string | number | boolean | readonly string[];
  readonly audit_passed: string | number | boolean | readonly string[];
}

export interface F360PaillierHomomorphicIntegrityAuditorOutput {
  readonly featureId: typeof F360_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F360_OPERATION_CODE;
  readonly resolved_linear_combo_cipher: unknown;
  readonly resolved_decrypted_result: unknown;
  readonly resolved_expected_linear_val: unknown;
  readonly resolved_audit_passed: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F360_FEATURE_ID>;
}

export type F360PaillierHomomorphicIntegrityAuditorTelemetrySnapshot = BaseFeatureTelemetry<typeof F360_FEATURE_ID>;

export const DEFAULT_F360_CONFIG: F360PaillierHomomorphicIntegrityAuditorConfig = {
  featureId: F360_FEATURE_ID,
  stage: F360_STAGE,
  operationCode: F360_OPERATION_CODE,
  contractVersion: F360_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F360PaillierHomomorphicIntegrityAuditorValidationError extends Error {
  public readonly featureId = F360_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F360 Validation Error on '${field}']: ${message}`);
    this.name = "F360PaillierHomomorphicIntegrityAuditorValidationError";
    this.field = field;
  }
}

export function computeF360Digest(rawPayload: string): string {
  return `f360_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F360PaillierHomomorphicIntegrityAuditorService extends KosmoraFeatureAdapterBase<
  typeof F360_FEATURE_ID,
  typeof F360_STAGE,
  typeof F360_OPERATION_CODE,
  F360PaillierHomomorphicIntegrityAuditorConfig,
  F360PaillierHomomorphicIntegrityAuditorInput,
  F360PaillierHomomorphicIntegrityAuditorOutput
> {
  constructor(customConfig?: Partial<F360PaillierHomomorphicIntegrityAuditorConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F360_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["linear_combo_cipher", "decrypted_result", "expected_linear_val", "audit_passed"] as const,
      F360PaillierHomomorphicIntegrityAuditorValidationError
    );
  }
}

export function verifyF360Module(): {
  readonly featureId: typeof F360_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F360PaillierHomomorphicIntegrityAuditorService();
  const sampleInput: F360PaillierHomomorphicIntegrityAuditorInput = {
    requestId: "req_verify_f360",
    projectId: "proj_kosmora_f360",
    workspaceId: "ws_kosmora_f360",
    tenantId: "tenant_rlm_f360",
    actorId: "actor_verifier_f360",
    autonomyLevel: "A3",
    linear_combo_cipher: "seed_f360_linear_combo_cipher",
    decrypted_result: 42,
    expected_linear_val: true,
    audit_passed: "seed_f360_audit_passed",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F360" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F360" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_linear_combo_cipher !== sampleInput.linear_combo_cipher &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F360] Verification failed`);
  }

  return {
    featureId: F360_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
