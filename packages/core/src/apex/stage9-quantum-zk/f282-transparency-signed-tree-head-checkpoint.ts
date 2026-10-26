/**
 * F282 (stage9-quantum-zk): Генератор подписанных вершин дерева прозрачности (Signed Tree Head)
 * Фиксация размера журнала и корневого хеша Меркла для внешней перекрёстной сверки
 * Operation Code: transparency_sth_checkpoint
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

export const F282_FEATURE_ID = "F282" as const;
export const F282_STAGE = "stage9-quantum-zk" as const;
export const F282_OPERATION_CODE = "transparency_sth_checkpoint" as const;
export const F282_CONTRACT_VERSION = "2.0.0" as const;

export type F282TransparencySignedTreeHeadCheckpointConfig = BaseFeatureConfig<
  typeof F282_FEATURE_ID,
  typeof F282_STAGE,
  typeof F282_OPERATION_CODE
>;

export interface F282TransparencySignedTreeHeadCheckpointInput extends BaseFeatureInput {
  readonly tree_size: string | number | boolean | readonly string[];
  readonly merkle_root_hash: string | number | boolean | readonly string[];
  readonly checkpoint_epoch: string | number | boolean | readonly string[];
  readonly signer_key_id: string | number | boolean | readonly string[];
}

export interface F282TransparencySignedTreeHeadCheckpointOutput {
  readonly featureId: typeof F282_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F282_OPERATION_CODE;
  readonly resolved_tree_size: unknown;
  readonly resolved_merkle_root_hash: unknown;
  readonly resolved_checkpoint_epoch: unknown;
  readonly resolved_signer_key_id: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F282_FEATURE_ID>;
}

export type F282TransparencySignedTreeHeadCheckpointTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F282_FEATURE_ID
>;

export const DEFAULT_F282_CONFIG: F282TransparencySignedTreeHeadCheckpointConfig = {
  featureId: F282_FEATURE_ID,
  stage: F282_STAGE,
  operationCode: F282_OPERATION_CODE,
  contractVersion: F282_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F282TransparencySignedTreeHeadCheckpointValidationError extends Error {
  public readonly featureId = F282_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F282 Validation Error on '${field}']: ${message}`);
    this.name = "F282TransparencySignedTreeHeadCheckpointValidationError";
    this.field = field;
  }
}

export function computeF282Digest(rawPayload: string): string {
  return `f282_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F282TransparencySignedTreeHeadCheckpointService extends KosmoraFeatureAdapterBase<
  typeof F282_FEATURE_ID,
  typeof F282_STAGE,
  typeof F282_OPERATION_CODE,
  F282TransparencySignedTreeHeadCheckpointConfig,
  F282TransparencySignedTreeHeadCheckpointInput,
  F282TransparencySignedTreeHeadCheckpointOutput
> {
  constructor(
    customConfig?: Partial<F282TransparencySignedTreeHeadCheckpointConfig>,
    kernel?: Stage9QuantumZkKernel
  ) {
    super(
      DEFAULT_F282_CONFIG,
      customConfig,
      kernel ?? Stage9QuantumZkKernel.getShared(),
      ["tree_size", "merkle_root_hash", "checkpoint_epoch", "signer_key_id"] as const,
      F282TransparencySignedTreeHeadCheckpointValidationError
    );
  }
}

export function verifyF282Module(): {
  readonly featureId: typeof F282_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F282TransparencySignedTreeHeadCheckpointService();
  const sampleInput: F282TransparencySignedTreeHeadCheckpointInput = {
    requestId: "req_verify_f282",
    projectId: "proj_kosmora_f282",
    workspaceId: "ws_kosmora_f282",
    tenantId: "tenant_rlm_f282",
    actorId: "actor_verifier_f282",
    autonomyLevel: "A3",
    tree_size: "seed_f282_tree_size",
    merkle_root_hash: 42,
    checkpoint_epoch: true,
    signer_key_id: "seed_f282_signer_key_id",
    metadata: { stage: "stage9-quantum-zk", featureId: "F282" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F282" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tree_size !== sampleInput.tree_size &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F282] Verification failed`);
  }

  return {
    featureId: F282_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
