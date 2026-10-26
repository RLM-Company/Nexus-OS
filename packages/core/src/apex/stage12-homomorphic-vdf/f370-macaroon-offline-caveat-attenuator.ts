/**
 * F370 (stage12-homomorphic-vdf): Делегирующий ограничитель полномочий макаруна (Offline Caveat Attenuation)
 * Сужение прав токена дочернему суб-агенту (добавление условий tenant, project, op, ttl) без обращения к серверу ключей
 * Operation Code: macaroon_attenuator
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

export const F370_FEATURE_ID = "F370" as const;
export const F370_STAGE = "stage12-homomorphic-vdf" as const;
export const F370_OPERATION_CODE = "macaroon_attenuator" as const;
export const F370_CONTRACT_VERSION = "2.0.0" as const;

export type F370MacaroonOfflineCaveatAttenuatorConfig = BaseFeatureConfig<
  typeof F370_FEATURE_ID,
  typeof F370_STAGE,
  typeof F370_OPERATION_CODE
>;

export interface F370MacaroonOfflineCaveatAttenuatorInput extends BaseFeatureInput {
  readonly parent_macaroon_id: string | number | boolean | readonly string[];
  readonly added_caveats: string | number | boolean | readonly string[];
  readonly attenuated_sig_hex: string | number | boolean | readonly string[];
  readonly delegation_safe: string | number | boolean | readonly string[];
}

export interface F370MacaroonOfflineCaveatAttenuatorOutput {
  readonly featureId: typeof F370_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F370_OPERATION_CODE;
  readonly resolved_parent_macaroon_id: unknown;
  readonly resolved_added_caveats: unknown;
  readonly resolved_attenuated_sig_hex: unknown;
  readonly resolved_delegation_safe: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F370_FEATURE_ID>;
}

export type F370MacaroonOfflineCaveatAttenuatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F370_FEATURE_ID
>;

export const DEFAULT_F370_CONFIG: F370MacaroonOfflineCaveatAttenuatorConfig = {
  featureId: F370_FEATURE_ID,
  stage: F370_STAGE,
  operationCode: F370_OPERATION_CODE,
  contractVersion: F370_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F370MacaroonOfflineCaveatAttenuatorValidationError extends Error {
  public readonly featureId = F370_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F370 Validation Error on '${field}']: ${message}`);
    this.name = "F370MacaroonOfflineCaveatAttenuatorValidationError";
    this.field = field;
  }
}

export function computeF370Digest(rawPayload: string): string {
  return `f370_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F370MacaroonOfflineCaveatAttenuatorService extends KosmoraFeatureAdapterBase<
  typeof F370_FEATURE_ID,
  typeof F370_STAGE,
  typeof F370_OPERATION_CODE,
  F370MacaroonOfflineCaveatAttenuatorConfig,
  F370MacaroonOfflineCaveatAttenuatorInput,
  F370MacaroonOfflineCaveatAttenuatorOutput
> {
  constructor(
    customConfig?: Partial<F370MacaroonOfflineCaveatAttenuatorConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F370_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["parent_macaroon_id", "added_caveats", "attenuated_sig_hex", "delegation_safe"] as const,
      F370MacaroonOfflineCaveatAttenuatorValidationError
    );
  }
}

export function verifyF370Module(): {
  readonly featureId: typeof F370_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F370MacaroonOfflineCaveatAttenuatorService();
  const sampleInput: F370MacaroonOfflineCaveatAttenuatorInput = {
    requestId: "req_verify_f370",
    projectId: "proj_kosmora_f370",
    workspaceId: "ws_kosmora_f370",
    tenantId: "tenant_rlm_f370",
    actorId: "actor_verifier_f370",
    autonomyLevel: "A3",
    parent_macaroon_id: "seed_f370_parent_macaroon_id",
    added_caveats: 42,
    attenuated_sig_hex: true,
    delegation_safe: "seed_f370_delegation_safe",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F370" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F370" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_parent_macaroon_id !== sampleInput.parent_macaroon_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F370] Verification failed`);
  }

  return {
    featureId: F370_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
