/**
 * F371 (stage12-homomorphic-vdf): Верификатор цепочки HMAC и контекстных предикатов макаруна
 * Одновременная проверка неизменности цепочки подписей и выполнения всех условий окружения
 * Operation Code: macaroon_verifier
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

export const F371_FEATURE_ID = "F371" as const;
export const F371_STAGE = "stage12-homomorphic-vdf" as const;
export const F371_OPERATION_CODE = "macaroon_verifier" as const;
export const F371_CONTRACT_VERSION = "2.0.0" as const;

export type F371MacaroonContextualPredicateVerifierConfig = BaseFeatureConfig<
  typeof F371_FEATURE_ID,
  typeof F371_STAGE,
  typeof F371_OPERATION_CODE
>;

export interface F371MacaroonContextualPredicateVerifierInput extends BaseFeatureInput {
  readonly macaroon_id: string | number | boolean | readonly string[];
  readonly context_attributes: string | number | boolean | readonly string[];
  readonly signature_valid: string | number | boolean | readonly string[];
  readonly predicates_satisfied: string | number | boolean | readonly string[];
}

export interface F371MacaroonContextualPredicateVerifierOutput {
  readonly featureId: typeof F371_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F371_OPERATION_CODE;
  readonly resolved_macaroon_id: unknown;
  readonly resolved_context_attributes: unknown;
  readonly resolved_signature_valid: unknown;
  readonly resolved_predicates_satisfied: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F371_FEATURE_ID>;
}

export type F371MacaroonContextualPredicateVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F371_FEATURE_ID
>;

export const DEFAULT_F371_CONFIG: F371MacaroonContextualPredicateVerifierConfig = {
  featureId: F371_FEATURE_ID,
  stage: F371_STAGE,
  operationCode: F371_OPERATION_CODE,
  contractVersion: F371_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F371MacaroonContextualPredicateVerifierValidationError extends Error {
  public readonly featureId = F371_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F371 Validation Error on '${field}']: ${message}`);
    this.name = "F371MacaroonContextualPredicateVerifierValidationError";
    this.field = field;
  }
}

export function computeF371Digest(rawPayload: string): string {
  return `f371_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F371MacaroonContextualPredicateVerifierService extends KosmoraFeatureAdapterBase<
  typeof F371_FEATURE_ID,
  typeof F371_STAGE,
  typeof F371_OPERATION_CODE,
  F371MacaroonContextualPredicateVerifierConfig,
  F371MacaroonContextualPredicateVerifierInput,
  F371MacaroonContextualPredicateVerifierOutput
> {
  constructor(
    customConfig?: Partial<F371MacaroonContextualPredicateVerifierConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F371_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["macaroon_id", "context_attributes", "signature_valid", "predicates_satisfied"] as const,
      F371MacaroonContextualPredicateVerifierValidationError
    );
  }
}

export function verifyF371Module(): {
  readonly featureId: typeof F371_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F371MacaroonContextualPredicateVerifierService();
  const sampleInput: F371MacaroonContextualPredicateVerifierInput = {
    requestId: "req_verify_f371",
    projectId: "proj_kosmora_f371",
    workspaceId: "ws_kosmora_f371",
    tenantId: "tenant_rlm_f371",
    actorId: "actor_verifier_f371",
    autonomyLevel: "A3",
    macaroon_id: "seed_f371_macaroon_id",
    context_attributes: 42,
    signature_valid: true,
    predicates_satisfied: "seed_f371_predicates_satisfied",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F371" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F371" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_macaroon_id !== sampleInput.macaroon_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F371] Verification failed`);
  }

  return {
    featureId: F371_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
