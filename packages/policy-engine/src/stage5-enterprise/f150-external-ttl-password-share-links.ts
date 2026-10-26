/**
 * F150 (stage5-enterprise): Безопасный шаринг артефактов по внешним ссылкам
 * Генерация read-only ссылок на отчёты и презентации с паролем и сроком жизни (TTL)
 * Operation Code: secure_share_link_issuer
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

export const F150_FEATURE_ID = "F150" as const;
export const F150_STAGE = "stage5-enterprise" as const;
export const F150_OPERATION_CODE = "secure_share_link_issuer" as const;
export const F150_CONTRACT_VERSION = "2.0.0" as const;

export type F150ExternalTtlPasswordShareLinksExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F150ExternalTtlPasswordShareLinksConfig = BaseFeatureConfig<
  typeof F150_FEATURE_ID,
  typeof F150_STAGE,
  typeof F150_OPERATION_CODE
>;

export interface F150ExternalTtlPasswordShareLinksInput extends BaseFeatureInput {
  readonly share_token: string;
  readonly artifact_id: string | number;
  readonly expires_at_iso: string | number | boolean | readonly string[];
  readonly password_protected: string | number | boolean | Record<string, unknown>;
}

export type F150ExternalTtlPasswordShareLinksAuditEntry = BaseFeatureAuditEntry<typeof F150_FEATURE_ID>;

export interface F150ExternalTtlPasswordShareLinksOutput {
  readonly featureId: typeof F150_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F150ExternalTtlPasswordShareLinksExecutionStatus;
  readonly operationCode: typeof F150_OPERATION_CODE;
  readonly resolved_share_token: string;
  readonly resolved_artifact_id: string | number;
  readonly resolved_expires_at_iso: string | number | boolean | readonly string[];
  readonly resolved_password_protected: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F150ExternalTtlPasswordShareLinksAuditEntry;
}

export type F150ExternalTtlPasswordShareLinksTelemetrySnapshot = BaseFeatureTelemetry<typeof F150_FEATURE_ID>;

export const DEFAULT_F150_CONFIG: F150ExternalTtlPasswordShareLinksConfig = {
  featureId: F150_FEATURE_ID,
  stage: F150_STAGE,
  operationCode: F150_OPERATION_CODE,
  contractVersion: F150_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F150ExternalTtlPasswordShareLinksValidationError extends Error {
  public readonly featureId = F150_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F150 Validation Error on '${field}']: ${message}`);
    this.name = "F150ExternalTtlPasswordShareLinksValidationError";
    this.field = field;
  }
}

export function computeF150Digest(rawPayload: string): string {
  return `f150_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F150ExternalTtlPasswordShareLinksEngine extends KosmoraFeatureAdapterBase<
  typeof F150_FEATURE_ID,
  typeof F150_STAGE,
  typeof F150_OPERATION_CODE,
  F150ExternalTtlPasswordShareLinksConfig,
  F150ExternalTtlPasswordShareLinksInput,
  F150ExternalTtlPasswordShareLinksOutput
> {
  constructor(customConfig?: Partial<F150ExternalTtlPasswordShareLinksConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F150_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["share_token", "artifact_id", "expires_at_iso", "password_protected"] as const,
      F150ExternalTtlPasswordShareLinksValidationError
    );
  }
}

export function verifyF150Module(): {
  featureId: typeof F150_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F150ExternalTtlPasswordShareLinksEngine();
  const sampleInput: F150ExternalTtlPasswordShareLinksInput = {
    requestId: "req_verify_f150",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    share_token: "f150_share_token_seed",
    artifact_id: 42,
    expires_at_iso: true,
    password_protected: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 150 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F150" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_share_token !== sampleInput.share_token &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F150_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
