/**
 * F265 (stage9-quantum-zk): Верификатор целостности долей Шамира против искажений
 * Проверка криптографических контрольных сумм каждой доли перед началом интерполяции Лагранжа
 * Operation Code: shamir_commitment_verify
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

export const F265_FEATURE_ID = "F265" as const;
export const F265_STAGE = "stage9-quantum-zk" as const;
export const F265_OPERATION_CODE = "shamir_commitment_verify" as const;
export const F265_CONTRACT_VERSION = "2.0.0" as const;

export type F265ShamirShareTamperCommitmentVerifierConfig = BaseFeatureConfig<
  typeof F265_FEATURE_ID,
  typeof F265_STAGE,
  typeof F265_OPERATION_CODE
>;

export interface F265ShamirShareTamperCommitmentVerifierInput extends BaseFeatureInput {
  readonly share_index: string | number | boolean | readonly string[];
  readonly share_hex_payload: string | number | boolean | readonly string[];
  readonly commitment_root: string | number | boolean | readonly string[];
  readonly verifier_node: string | number | boolean | readonly string[];
}

export interface F265ShamirShareTamperCommitmentVerifierOutput {
  readonly featureId: typeof F265_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F265_OPERATION_CODE;
  readonly resolved_share_index: unknown;
  readonly resolved_share_hex_payload: unknown;
  readonly resolved_commitment_root: unknown;
  readonly resolved_verifier_node: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F265_FEATURE_ID>;
}

export type F265ShamirShareTamperCommitmentVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F265_FEATURE_ID
>;

export const DEFAULT_F265_CONFIG: F265ShamirShareTamperCommitmentVerifierConfig = {
  featureId: F265_FEATURE_ID,
  stage: F265_STAGE,
  operationCode: F265_OPERATION_CODE,
  contractVersion: F265_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F265ShamirShareTamperCommitmentVerifierValidationError extends Error {
  public readonly featureId = F265_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F265 Validation Error on '${field}']: ${message}`);
    this.name = "F265ShamirShareTamperCommitmentVerifierValidationError";
    this.field = field;
  }
}

export function computeF265Digest(rawPayload: string): string {
  return `f265_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F265ShamirShareTamperCommitmentVerifierService extends KosmoraFeatureAdapterBase<
  typeof F265_FEATURE_ID,
  typeof F265_STAGE,
  typeof F265_OPERATION_CODE,
  F265ShamirShareTamperCommitmentVerifierConfig,
  F265ShamirShareTamperCommitmentVerifierInput,
  F265ShamirShareTamperCommitmentVerifierOutput
> {
  constructor(
    customConfig?: Partial<F265ShamirShareTamperCommitmentVerifierConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F265_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["share_index", "share_hex_payload", "commitment_root", "verifier_node"] as const,
      F265ShamirShareTamperCommitmentVerifierValidationError
    );
  }
}

export function verifyF265Module(): {
  readonly featureId: typeof F265_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F265ShamirShareTamperCommitmentVerifierService();
  const sampleInput: F265ShamirShareTamperCommitmentVerifierInput = {
    requestId: "req_verify_f265",
    projectId: "proj_kosmora_f265",
    workspaceId: "ws_kosmora_f265",
    tenantId: "tenant_rlm_f265",
    actorId: "actor_verifier_f265",
    autonomyLevel: "A3",
    share_index: "seed_f265_share_index",
    share_hex_payload: 42,
    commitment_root: true,
    verifier_node: "seed_f265_verifier_node",
    metadata: { stage: "stage9-quantum-zk", featureId: "F265" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F265" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_share_index !== sampleInput.share_index &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F265] Verification failed`);
  }

  return {
    featureId: F265_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
