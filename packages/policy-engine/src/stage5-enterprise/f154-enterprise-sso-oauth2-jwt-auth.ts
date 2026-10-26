/**
 * F154 (stage5-enterprise): Единый вход и корпоративная авторизация (SSO / OAuth2 / JWT)
 * Бесшовный вход через провайдеров идентификации с двухфакторной защитой
 * Operation Code: sso_jwt_verifier
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F154_FEATURE_ID = "F154" as const;
export const F154_STAGE = "stage5-enterprise" as const;
export const F154_OPERATION_CODE = "sso_jwt_verifier" as const;
export const F154_CONTRACT_VERSION = "2.0.0" as const;

export type F154EnterpriseSsoOauth2JwtAuthExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F154EnterpriseSsoOauth2JwtAuthConfig = BaseFeatureConfig<
  typeof F154_FEATURE_ID,
  typeof F154_STAGE,
  typeof F154_OPERATION_CODE
>;

export interface F154EnterpriseSsoOauth2JwtAuthInput extends BaseFeatureInput {
  readonly idp_provider: string;
  readonly subject_claim: string | number;
  readonly mfa_verified: string | number | boolean | readonly string[];
  readonly session_token_issued: string | number | boolean | Record<string, unknown>;
}

export type F154EnterpriseSsoOauth2JwtAuthAuditEntry = BaseFeatureAuditEntry<typeof F154_FEATURE_ID>;

export interface F154EnterpriseSsoOauth2JwtAuthOutput {
  readonly featureId: typeof F154_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F154EnterpriseSsoOauth2JwtAuthExecutionStatus;
  readonly operationCode: typeof F154_OPERATION_CODE;
  readonly resolved_idp_provider: string;
  readonly resolved_subject_claim: string | number;
  readonly resolved_mfa_verified: string | number | boolean | readonly string[];
  readonly resolved_session_token_issued: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F154EnterpriseSsoOauth2JwtAuthAuditEntry;
}

export type F154EnterpriseSsoOauth2JwtAuthTelemetrySnapshot = BaseFeatureTelemetry<typeof F154_FEATURE_ID>;

export const DEFAULT_F154_CONFIG: F154EnterpriseSsoOauth2JwtAuthConfig = {
  featureId: F154_FEATURE_ID,
  stage: F154_STAGE,
  operationCode: F154_OPERATION_CODE,
  contractVersion: F154_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F154EnterpriseSsoOauth2JwtAuthValidationError extends Error {
  public readonly featureId = F154_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F154 Validation Error on '${field}']: ${message}`);
    this.name = "F154EnterpriseSsoOauth2JwtAuthValidationError";
    this.field = field;
  }
}

export function computeF154Digest(rawPayload: string): string {
  return `f154_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F154EnterpriseSsoOauth2JwtAuthEngine extends KosmoraFeatureAdapterBase<
  typeof F154_FEATURE_ID,
  typeof F154_STAGE,
  typeof F154_OPERATION_CODE,
  F154EnterpriseSsoOauth2JwtAuthConfig,
  F154EnterpriseSsoOauth2JwtAuthInput,
  F154EnterpriseSsoOauth2JwtAuthOutput
> {
  constructor(customConfig?: Partial<F154EnterpriseSsoOauth2JwtAuthConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F154_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["idp_provider", "subject_claim", "mfa_verified", "session_token_issued"] as const,
      F154EnterpriseSsoOauth2JwtAuthValidationError
    );
  }
}

export function verifyF154Module(): {
  featureId: typeof F154_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F154EnterpriseSsoOauth2JwtAuthEngine();
  const sampleInput: F154EnterpriseSsoOauth2JwtAuthInput = {
    requestId: "req_verify_f154",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    idp_provider: "f154_idp_provider_seed",
    subject_claim: 42,
    mfa_verified: true,
    session_token_issued: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 154 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F154" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_idp_provider !== sampleInput.idp_provider &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F154_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
