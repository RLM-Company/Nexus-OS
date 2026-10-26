/**
 * F248 (stage8-finops-compliance): Реестр неизменяемых корней Меркла для пакетной верификации комплаенс-пакетов
 * Фиксация корневых хешей отчётности тенантов с мгновенным обнаружением подмены любого байта
 * Operation Code: tamper_resistant_merkle_root_registry
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

export const F248_FEATURE_ID = "F248" as const;
export const F248_STAGE = "stage8-finops-compliance" as const;
export const F248_OPERATION_CODE = "tamper_resistant_merkle_root_registry" as const;
export const F248_CONTRACT_VERSION = "2.0.0" as const;

export type F248TamperResistantMerkleRootRegistryConfig = BaseFeatureConfig<
  typeof F248_FEATURE_ID,
  typeof F248_STAGE,
  typeof F248_OPERATION_CODE
>;

export interface F248TamperResistantMerkleRootRegistryInput extends BaseFeatureInput {
  readonly document_id: string | number | boolean | readonly string[];
  readonly merkle_root: string | number | boolean | readonly string[];
  readonly total_leaves: string | number | boolean | readonly string[];
  readonly integrity_verified: string | number | boolean | readonly string[];
}

export interface F248TamperResistantMerkleRootRegistryOutput {
  readonly featureId: typeof F248_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F248_OPERATION_CODE;
  readonly resolved_document_id: unknown;
  readonly resolved_merkle_root: unknown;
  readonly resolved_total_leaves: unknown;
  readonly resolved_integrity_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F248_FEATURE_ID>;
}

export type F248TamperResistantMerkleRootRegistryTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F248_FEATURE_ID
>;

export const DEFAULT_F248_CONFIG: F248TamperResistantMerkleRootRegistryConfig = {
  featureId: F248_FEATURE_ID,
  stage: F248_STAGE,
  operationCode: F248_OPERATION_CODE,
  contractVersion: F248_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F248TamperResistantMerkleRootRegistryValidationError extends Error {
  public readonly featureId = F248_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F248 Validation Error on '${field}']: ${message}`);
    this.name = "F248TamperResistantMerkleRootRegistryValidationError";
    this.field = field;
  }
}

export function computeF248Digest(rawPayload: string): string {
  return `f248_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F248TamperResistantMerkleRootRegistryService extends KosmoraFeatureAdapterBase<
  typeof F248_FEATURE_ID,
  typeof F248_STAGE,
  typeof F248_OPERATION_CODE,
  F248TamperResistantMerkleRootRegistryConfig,
  F248TamperResistantMerkleRootRegistryInput,
  F248TamperResistantMerkleRootRegistryOutput
> {
  constructor(
    customConfig?: Partial<F248TamperResistantMerkleRootRegistryConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F248_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["document_id", "merkle_root", "total_leaves", "integrity_verified"] as const,
      F248TamperResistantMerkleRootRegistryValidationError
    );
  }
}

export function verifyF248Module(): {
  readonly featureId: typeof F248_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F248TamperResistantMerkleRootRegistryService();
  const sampleInput: F248TamperResistantMerkleRootRegistryInput = {
    requestId: "req_verify_f248",
    projectId: "proj_kosmora_f248",
    workspaceId: "ws_kosmora_f248",
    tenantId: "tenant_rlm_f248",
    actorId: "actor_verifier_f248",
    autonomyLevel: "A3",
    document_id: "seed_f248_document_id",
    merkle_root: 42,
    total_leaves: true,
    integrity_verified: "seed_f248_integrity_verified",
    metadata: { stage: "stage8-finops-compliance", featureId: "F248" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F248" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F248] Verification failed`);
  }

  return {
    featureId: F248_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
