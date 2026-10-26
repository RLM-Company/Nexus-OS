/**
 * F149 (stage5-enterprise): Публичное REST / GraphQL API платформы
 * Возможность запускать задачи Kosmora и забирать готовые артефакты из внешних B2B-систем
 * Operation Code: b2b_api_gateway
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

export const F149_FEATURE_ID = "F149" as const;
export const F149_STAGE = "stage5-enterprise" as const;
export const F149_OPERATION_CODE = "b2b_api_gateway" as const;
export const F149_CONTRACT_VERSION = "2.0.0" as const;

export type F149PublicB2bRestGraphqlApiExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F149PublicB2bRestGraphqlApiConfig = BaseFeatureConfig<
  typeof F149_FEATURE_ID,
  typeof F149_STAGE,
  typeof F149_OPERATION_CODE
>;

export interface F149PublicB2bRestGraphqlApiInput extends BaseFeatureInput {
  readonly api_key_id: string;
  readonly graphql_or_rest_op: string | number;
  readonly rate_limit_remaining: string | number | boolean | readonly string[];
  readonly response_envelope: string | number | boolean | Record<string, unknown>;
}

export type F149PublicB2bRestGraphqlApiAuditEntry = BaseFeatureAuditEntry<typeof F149_FEATURE_ID>;

export interface F149PublicB2bRestGraphqlApiOutput {
  readonly featureId: typeof F149_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F149PublicB2bRestGraphqlApiExecutionStatus;
  readonly operationCode: typeof F149_OPERATION_CODE;
  readonly resolved_api_key_id: string;
  readonly resolved_graphql_or_rest_op: string | number;
  readonly resolved_rate_limit_remaining: string | number | boolean | readonly string[];
  readonly resolved_response_envelope: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F149PublicB2bRestGraphqlApiAuditEntry;
}

export type F149PublicB2bRestGraphqlApiTelemetrySnapshot = BaseFeatureTelemetry<typeof F149_FEATURE_ID>;

export const DEFAULT_F149_CONFIG: F149PublicB2bRestGraphqlApiConfig = {
  featureId: F149_FEATURE_ID,
  stage: F149_STAGE,
  operationCode: F149_OPERATION_CODE,
  contractVersion: F149_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F149PublicB2bRestGraphqlApiValidationError extends Error {
  public readonly featureId = F149_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F149 Validation Error on '${field}']: ${message}`);
    this.name = "F149PublicB2bRestGraphqlApiValidationError";
    this.field = field;
  }
}

export function computeF149Digest(rawPayload: string): string {
  return `f149_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F149PublicB2bRestGraphqlApiEngine extends KosmoraFeatureAdapterBase<
  typeof F149_FEATURE_ID,
  typeof F149_STAGE,
  typeof F149_OPERATION_CODE,
  F149PublicB2bRestGraphqlApiConfig,
  F149PublicB2bRestGraphqlApiInput,
  F149PublicB2bRestGraphqlApiOutput
> {
  constructor(customConfig?: Partial<F149PublicB2bRestGraphqlApiConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F149_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["api_key_id", "graphql_or_rest_op", "rate_limit_remaining", "response_envelope"] as const,
      F149PublicB2bRestGraphqlApiValidationError
    );
  }
}

export function verifyF149Module(): {
  featureId: typeof F149_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F149PublicB2bRestGraphqlApiEngine();
  const sampleInput: F149PublicB2bRestGraphqlApiInput = {
    requestId: "req_verify_f149",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    api_key_id: "f149_api_key_id_seed",
    graphql_or_rest_op: 42,
    rate_limit_remaining: true,
    response_envelope: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 149 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F149" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_api_key_id !== sampleInput.api_key_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F149_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
