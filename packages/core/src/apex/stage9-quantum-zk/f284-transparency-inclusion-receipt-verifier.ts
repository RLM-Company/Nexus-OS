/**
 * F284 (stage9-quantum-zk): Верификатор квитанций включения в журнал прозрачности
 * Независимая проверка того, что событие действительно зафиксировано в неизменяемом дереве Меркла
 * Operation Code: transparency_receipt_verify
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

export const F284_FEATURE_ID = "F284" as const;
export const F284_STAGE = "stage9-quantum-zk" as const;
export const F284_OPERATION_CODE = "transparency_receipt_verify" as const;
export const F284_CONTRACT_VERSION = "2.0.0" as const;

export type F284TransparencyInclusionReceiptVerifierConfig = BaseFeatureConfig<
  typeof F284_FEATURE_ID,
  typeof F284_STAGE,
  typeof F284_OPERATION_CODE
>;

export interface F284TransparencyInclusionReceiptVerifierInput extends BaseFeatureInput {
  readonly entry_id: string | number | boolean | readonly string[];
  readonly leaf_hash: string | number | boolean | readonly string[];
  readonly inclusion_proof_nodes: string | number | boolean | readonly string[];
  readonly expected_merkle_root: string | number | boolean | readonly string[];
}

export interface F284TransparencyInclusionReceiptVerifierOutput {
  readonly featureId: typeof F284_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F284_OPERATION_CODE;
  readonly resolved_entry_id: unknown;
  readonly resolved_leaf_hash: unknown;
  readonly resolved_inclusion_proof_nodes: unknown;
  readonly resolved_expected_merkle_root: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F284_FEATURE_ID>;
}

export type F284TransparencyInclusionReceiptVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F284_FEATURE_ID
>;

export const DEFAULT_F284_CONFIG: F284TransparencyInclusionReceiptVerifierConfig = {
  featureId: F284_FEATURE_ID,
  stage: F284_STAGE,
  operationCode: F284_OPERATION_CODE,
  contractVersion: F284_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F284TransparencyInclusionReceiptVerifierValidationError extends Error {
  public readonly featureId = F284_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F284 Validation Error on '${field}']: ${message}`);
    this.name = "F284TransparencyInclusionReceiptVerifierValidationError";
    this.field = field;
  }
}

export function computeF284Digest(rawPayload: string): string {
  return `f284_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F284TransparencyInclusionReceiptVerifierService extends KosmoraFeatureAdapterBase<
  typeof F284_FEATURE_ID,
  typeof F284_STAGE,
  typeof F284_OPERATION_CODE,
  F284TransparencyInclusionReceiptVerifierConfig,
  F284TransparencyInclusionReceiptVerifierInput,
  F284TransparencyInclusionReceiptVerifierOutput
> {
  constructor(
    customConfig?: Partial<F284TransparencyInclusionReceiptVerifierConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F284_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["entry_id", "leaf_hash", "inclusion_proof_nodes", "expected_merkle_root"] as const,
      F284TransparencyInclusionReceiptVerifierValidationError
    );
  }
}

export function verifyF284Module(): {
  readonly featureId: typeof F284_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F284TransparencyInclusionReceiptVerifierService();
  const sampleInput: F284TransparencyInclusionReceiptVerifierInput = {
    requestId: "req_verify_f284",
    projectId: "proj_kosmora_f284",
    workspaceId: "ws_kosmora_f284",
    tenantId: "tenant_rlm_f284",
    actorId: "actor_verifier_f284",
    autonomyLevel: "A3",
    entry_id: "seed_f284_entry_id",
    leaf_hash: 42,
    inclusion_proof_nodes: true,
    expected_merkle_root: "seed_f284_expected_merkle_root",
    metadata: { stage: "stage9-quantum-zk", featureId: "F284" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F284" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_entry_id !== sampleInput.entry_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F284] Verification failed`);
  }

  return {
    featureId: F284_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
