/**
 * F260 (stage9-quantum-zk): Защитник доменного разделения подключей
 * Гарантия криптографической ортогональности ключей для подписи, шифрования и аудита
 * Operation Code: hkdf_domain_separation
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

export const F260_FEATURE_ID = "F260" as const;
export const F260_STAGE = "stage9-quantum-zk" as const;
export const F260_OPERATION_CODE = "hkdf_domain_separation" as const;
export const F260_CONTRACT_VERSION = "2.0.0" as const;

export type F260HkdfSubkeyDomainSeparationGuardConfig = BaseFeatureConfig<
  typeof F260_FEATURE_ID,
  typeof F260_STAGE,
  typeof F260_OPERATION_CODE
>;

export interface F260HkdfSubkeyDomainSeparationGuardInput extends BaseFeatureInput {
  readonly source_key_id: string | number | boolean | readonly string[];
  readonly domain_tag_a: string | number | boolean | readonly string[];
  readonly domain_tag_b: string | number | boolean | readonly string[];
  readonly collision_policy: string | number | boolean | readonly string[];
}

export interface F260HkdfSubkeyDomainSeparationGuardOutput {
  readonly featureId: typeof F260_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F260_OPERATION_CODE;
  readonly resolved_source_key_id: unknown;
  readonly resolved_domain_tag_a: unknown;
  readonly resolved_domain_tag_b: unknown;
  readonly resolved_collision_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F260_FEATURE_ID>;
}

export type F260HkdfSubkeyDomainSeparationGuardTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F260_FEATURE_ID
>;

export const DEFAULT_F260_CONFIG: F260HkdfSubkeyDomainSeparationGuardConfig = {
  featureId: F260_FEATURE_ID,
  stage: F260_STAGE,
  operationCode: F260_OPERATION_CODE,
  contractVersion: F260_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F260HkdfSubkeyDomainSeparationGuardValidationError extends Error {
  public readonly featureId = F260_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F260 Validation Error on '${field}']: ${message}`);
    this.name = "F260HkdfSubkeyDomainSeparationGuardValidationError";
    this.field = field;
  }
}

export function computeF260Digest(rawPayload: string): string {
  return `f260_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F260HkdfSubkeyDomainSeparationGuardService extends KosmoraFeatureAdapterBase<
  typeof F260_FEATURE_ID,
  typeof F260_STAGE,
  typeof F260_OPERATION_CODE,
  F260HkdfSubkeyDomainSeparationGuardConfig,
  F260HkdfSubkeyDomainSeparationGuardInput,
  F260HkdfSubkeyDomainSeparationGuardOutput
> {
  constructor(
    customConfig?: Partial<F260HkdfSubkeyDomainSeparationGuardConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F260_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["source_key_id", "domain_tag_a", "domain_tag_b", "collision_policy"] as const,
      F260HkdfSubkeyDomainSeparationGuardValidationError
    );
  }
}

export function verifyF260Module(): {
  readonly featureId: typeof F260_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F260HkdfSubkeyDomainSeparationGuardService();
  const sampleInput: F260HkdfSubkeyDomainSeparationGuardInput = {
    requestId: "req_verify_f260",
    projectId: "proj_kosmora_f260",
    workspaceId: "ws_kosmora_f260",
    tenantId: "tenant_rlm_f260",
    actorId: "actor_verifier_f260",
    autonomyLevel: "A3",
    source_key_id: "seed_f260_source_key_id",
    domain_tag_a: 42,
    domain_tag_b: true,
    collision_policy: "seed_f260_collision_policy",
    metadata: { stage: "stage9-quantum-zk", featureId: "F260" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F260" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_key_id !== sampleInput.source_key_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F260] Verification failed`);
  }

  return {
    featureId: F260_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
