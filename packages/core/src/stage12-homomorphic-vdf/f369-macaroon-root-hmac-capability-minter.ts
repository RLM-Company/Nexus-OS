/**
 * F369 (stage12-homomorphic-vdf): Эмитент корневых мандатов доступа на базе цепочечных HMAC (Capability Macaroons)
 * Выпуск криптографических токенов полномочий с корневой подписью HMAC-SHA256
 * Operation Code: macaroon_root_minter
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

export const F369_FEATURE_ID = "F369" as const;
export const F369_STAGE = "stage12-homomorphic-vdf" as const;
export const F369_OPERATION_CODE = "macaroon_root_minter" as const;
export const F369_CONTRACT_VERSION = "2.0.0" as const;

export type F369MacaroonRootHmacCapabilityMinterConfig = BaseFeatureConfig<
  typeof F369_FEATURE_ID,
  typeof F369_STAGE,
  typeof F369_OPERATION_CODE
>;

export interface F369MacaroonRootHmacCapabilityMinterInput extends BaseFeatureInput {
  readonly macaroon_id: string | number | boolean | readonly string[];
  readonly target_location: string | number | boolean | readonly string[];
  readonly caveats_count: string | number | boolean | readonly string[];
  readonly root_sig_hex: string | number | boolean | readonly string[];
}

export interface F369MacaroonRootHmacCapabilityMinterOutput {
  readonly featureId: typeof F369_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F369_OPERATION_CODE;
  readonly resolved_macaroon_id: unknown;
  readonly resolved_target_location: unknown;
  readonly resolved_caveats_count: unknown;
  readonly resolved_root_sig_hex: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F369_FEATURE_ID>;
}

export type F369MacaroonRootHmacCapabilityMinterTelemetrySnapshot = BaseFeatureTelemetry<typeof F369_FEATURE_ID>;

export const DEFAULT_F369_CONFIG: F369MacaroonRootHmacCapabilityMinterConfig = {
  featureId: F369_FEATURE_ID,
  stage: F369_STAGE,
  operationCode: F369_OPERATION_CODE,
  contractVersion: F369_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F369MacaroonRootHmacCapabilityMinterValidationError extends Error {
  public readonly featureId = F369_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F369 Validation Error on '${field}']: ${message}`);
    this.name = "F369MacaroonRootHmacCapabilityMinterValidationError";
    this.field = field;
  }
}

export function computeF369Digest(rawPayload: string): string {
  return `f369_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F369MacaroonRootHmacCapabilityMinterService extends KosmoraFeatureAdapterBase<
  typeof F369_FEATURE_ID,
  typeof F369_STAGE,
  typeof F369_OPERATION_CODE,
  F369MacaroonRootHmacCapabilityMinterConfig,
  F369MacaroonRootHmacCapabilityMinterInput,
  F369MacaroonRootHmacCapabilityMinterOutput
> {
  constructor(customConfig?: Partial<F369MacaroonRootHmacCapabilityMinterConfig>, kernel?: Stage12HomomorphicVdfKernel) {
    super(
      DEFAULT_F369_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["macaroon_id", "target_location", "caveats_count", "root_sig_hex"] as const,
      F369MacaroonRootHmacCapabilityMinterValidationError
    );
  }
}

export function verifyF369Module(): {
  readonly featureId: typeof F369_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F369MacaroonRootHmacCapabilityMinterService();
  const sampleInput: F369MacaroonRootHmacCapabilityMinterInput = {
    requestId: "req_verify_f369",
    projectId: "proj_kosmora_f369",
    workspaceId: "ws_kosmora_f369",
    tenantId: "tenant_rlm_f369",
    actorId: "actor_verifier_f369",
    autonomyLevel: "A3",
    macaroon_id: "seed_f369_macaroon_id",
    target_location: 42,
    caveats_count: true,
    root_sig_hex: "seed_f369_root_sig_hex",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F369" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F369" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_macaroon_id !== sampleInput.macaroon_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F369] Verification failed`);
  }

  return {
    featureId: F369_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
