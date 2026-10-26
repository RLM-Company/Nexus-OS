/**
 * F273 (stage9-quantum-zk): ZK-хранитель подтверждения владения мандатом агента
 * Аутентификация воркера в суверенном кластере через NIZKP без передачи секретного ключа по сети
 * Operation Code: zk_credential_witness
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

export const F273_FEATURE_ID = "F273" as const;
export const F273_STAGE = "stage9-quantum-zk" as const;
export const F273_OPERATION_CODE = "zk_credential_witness" as const;
export const F273_CONTRACT_VERSION = "2.0.0" as const;

export type F273ZkCredentialOwnershipWitnessGuardConfig = BaseFeatureConfig<
  typeof F273_FEATURE_ID,
  typeof F273_STAGE,
  typeof F273_OPERATION_CODE
>;

export interface F273ZkCredentialOwnershipWitnessGuardInput extends BaseFeatureInput {
  readonly credential_id: string | number | boolean | readonly string[];
  readonly holder_secret: string | number | boolean | readonly string[];
  readonly relying_party_id: string | number | boolean | readonly string[];
  readonly disclosure_scope: string | number | boolean | readonly string[];
}

export interface F273ZkCredentialOwnershipWitnessGuardOutput {
  readonly featureId: typeof F273_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F273_OPERATION_CODE;
  readonly resolved_credential_id: unknown;
  readonly resolved_holder_secret: unknown;
  readonly resolved_relying_party_id: unknown;
  readonly resolved_disclosure_scope: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F273_FEATURE_ID>;
}

export type F273ZkCredentialOwnershipWitnessGuardTelemetrySnapshot = BaseFeatureTelemetry<typeof F273_FEATURE_ID>;

export const DEFAULT_F273_CONFIG: F273ZkCredentialOwnershipWitnessGuardConfig = {
  featureId: F273_FEATURE_ID,
  stage: F273_STAGE,
  operationCode: F273_OPERATION_CODE,
  contractVersion: F273_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F273ZkCredentialOwnershipWitnessGuardValidationError extends Error {
  public readonly featureId = F273_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F273 Validation Error on '${field}']: ${message}`);
    this.name = "F273ZkCredentialOwnershipWitnessGuardValidationError";
    this.field = field;
  }
}

export function computeF273Digest(rawPayload: string): string {
  return `f273_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F273ZkCredentialOwnershipWitnessGuardService extends KosmoraFeatureAdapterBase<
  typeof F273_FEATURE_ID,
  typeof F273_STAGE,
  typeof F273_OPERATION_CODE,
  F273ZkCredentialOwnershipWitnessGuardConfig,
  F273ZkCredentialOwnershipWitnessGuardInput,
  F273ZkCredentialOwnershipWitnessGuardOutput
> {
  constructor(customConfig?: Partial<F273ZkCredentialOwnershipWitnessGuardConfig>, kernel?: Stage9QuantumZkKernel) {
    super(
      DEFAULT_F273_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["credential_id", "holder_secret", "relying_party_id", "disclosure_scope"] as const,
      F273ZkCredentialOwnershipWitnessGuardValidationError
    );
  }
}

export function verifyF273Module(): {
  readonly featureId: typeof F273_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F273ZkCredentialOwnershipWitnessGuardService();
  const sampleInput: F273ZkCredentialOwnershipWitnessGuardInput = {
    requestId: "req_verify_f273",
    projectId: "proj_kosmora_f273",
    workspaceId: "ws_kosmora_f273",
    tenantId: "tenant_rlm_f273",
    actorId: "actor_verifier_f273",
    autonomyLevel: "A3",
    credential_id: "seed_f273_credential_id",
    holder_secret: 42,
    relying_party_id: true,
    disclosure_scope: "seed_f273_disclosure_scope",
    metadata: { stage: "stage9-quantum-zk", featureId: "F273" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F273" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_credential_id !== sampleInput.credential_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F273] Verification failed`);
  }

  return {
    featureId: F273_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
