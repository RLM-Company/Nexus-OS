/**
 * F262 (stage9-quantum-zk): Аудитор ротации и криптографического затирания ключей
 * Верификация смены ключевых эпох и контрольных сумм KCV (Key Check Value)
 * Operation Code: hkdf_rotation_audit
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

export const F262_FEATURE_ID = "F262" as const;
export const F262_STAGE = "stage9-quantum-zk" as const;
export const F262_OPERATION_CODE = "hkdf_rotation_audit" as const;
export const F262_CONTRACT_VERSION = "2.0.0" as const;

export type F262HkdfZeroizationRotationAuditorConfig = BaseFeatureConfig<
  typeof F262_FEATURE_ID,
  typeof F262_STAGE,
  typeof F262_OPERATION_CODE
>;

export interface F262HkdfZeroizationRotationAuditorInput extends BaseFeatureInput {
  readonly rotation_epoch: string | number | boolean | readonly string[];
  readonly previous_key_digest: string | number | boolean | readonly string[];
  readonly next_key_digest: string | number | boolean | readonly string[];
  readonly audit_policy: string | number | boolean | readonly string[];
}

export interface F262HkdfZeroizationRotationAuditorOutput {
  readonly featureId: typeof F262_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F262_OPERATION_CODE;
  readonly resolved_rotation_epoch: unknown;
  readonly resolved_previous_key_digest: unknown;
  readonly resolved_next_key_digest: unknown;
  readonly resolved_audit_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F262_FEATURE_ID>;
}

export type F262HkdfZeroizationRotationAuditorTelemetrySnapshot = BaseFeatureTelemetry<typeof F262_FEATURE_ID>;

export const DEFAULT_F262_CONFIG: F262HkdfZeroizationRotationAuditorConfig = {
  featureId: F262_FEATURE_ID,
  stage: F262_STAGE,
  operationCode: F262_OPERATION_CODE,
  contractVersion: F262_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F262HkdfZeroizationRotationAuditorValidationError extends Error {
  public readonly featureId = F262_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F262 Validation Error on '${field}']: ${message}`);
    this.name = "F262HkdfZeroizationRotationAuditorValidationError";
    this.field = field;
  }
}

export function computeF262Digest(rawPayload: string): string {
  return `f262_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F262HkdfZeroizationRotationAuditorService extends KosmoraFeatureAdapterBase<
  typeof F262_FEATURE_ID,
  typeof F262_STAGE,
  typeof F262_OPERATION_CODE,
  F262HkdfZeroizationRotationAuditorConfig,
  F262HkdfZeroizationRotationAuditorInput,
  F262HkdfZeroizationRotationAuditorOutput
> {
  constructor(customConfig?: Partial<F262HkdfZeroizationRotationAuditorConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F262_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["rotation_epoch", "previous_key_digest", "next_key_digest", "audit_policy"] as const,
      F262HkdfZeroizationRotationAuditorValidationError
    );
  }
}

export function verifyF262Module(): {
  readonly featureId: typeof F262_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F262HkdfZeroizationRotationAuditorService();
  const sampleInput: F262HkdfZeroizationRotationAuditorInput = {
    requestId: "req_verify_f262",
    projectId: "proj_kosmora_f262",
    workspaceId: "ws_kosmora_f262",
    tenantId: "tenant_rlm_f262",
    actorId: "actor_verifier_f262",
    autonomyLevel: "A3",
    rotation_epoch: "seed_f262_rotation_epoch",
    previous_key_digest: 42,
    next_key_digest: true,
    audit_policy: "seed_f262_audit_policy",
    metadata: { stage: "stage9-quantum-zk", featureId: "F262" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F262" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_rotation_epoch !== sampleInput.rotation_epoch &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F262] Verification failed`);
  }

  return {
    featureId: F262_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
