/**
 * F148 (stage5-enterprise): Вебхуки событий платформы для внешних систем
 * Отправка уведомлений в корпоративные шины при готовности отчёта или падении графа
 * Operation Code: webhook_dispatcher
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

export const F148_FEATURE_ID = "F148" as const;
export const F148_STAGE = "stage5-enterprise" as const;
export const F148_OPERATION_CODE = "webhook_dispatcher" as const;
export const F148_CONTRACT_VERSION = "2.0.0" as const;

export type F148OutboundPlatformEventWebhooksExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F148OutboundPlatformEventWebhooksConfig = BaseFeatureConfig<
  typeof F148_FEATURE_ID,
  typeof F148_STAGE,
  typeof F148_OPERATION_CODE
>;

export interface F148OutboundPlatformEventWebhooksInput extends BaseFeatureInput {
  readonly webhook_id: string;
  readonly event_topic: string | number;
  readonly hmac_signature: string | number | boolean | readonly string[];
  readonly delivery_http_status: string | number | boolean | Record<string, unknown>;
}

export type F148OutboundPlatformEventWebhooksAuditEntry = BaseFeatureAuditEntry<typeof F148_FEATURE_ID>;

export interface F148OutboundPlatformEventWebhooksOutput {
  readonly featureId: typeof F148_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F148OutboundPlatformEventWebhooksExecutionStatus;
  readonly operationCode: typeof F148_OPERATION_CODE;
  readonly resolved_webhook_id: string;
  readonly resolved_event_topic: string | number;
  readonly resolved_hmac_signature: string | number | boolean | readonly string[];
  readonly resolved_delivery_http_status: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F148OutboundPlatformEventWebhooksAuditEntry;
}

export type F148OutboundPlatformEventWebhooksTelemetrySnapshot = BaseFeatureTelemetry<typeof F148_FEATURE_ID>;

export const DEFAULT_F148_CONFIG: F148OutboundPlatformEventWebhooksConfig = {
  featureId: F148_FEATURE_ID,
  stage: F148_STAGE,
  operationCode: F148_OPERATION_CODE,
  contractVersion: F148_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F148OutboundPlatformEventWebhooksValidationError extends Error {
  public readonly featureId = F148_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F148 Validation Error on '${field}']: ${message}`);
    this.name = "F148OutboundPlatformEventWebhooksValidationError";
    this.field = field;
  }
}

export function computeF148Digest(rawPayload: string): string {
  return `f148_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F148OutboundPlatformEventWebhooksEngine extends KosmoraFeatureAdapterBase<
  typeof F148_FEATURE_ID,
  typeof F148_STAGE,
  typeof F148_OPERATION_CODE,
  F148OutboundPlatformEventWebhooksConfig,
  F148OutboundPlatformEventWebhooksInput,
  F148OutboundPlatformEventWebhooksOutput
> {
  constructor(customConfig?: Partial<F148OutboundPlatformEventWebhooksConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F148_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["webhook_id", "event_topic", "hmac_signature", "delivery_http_status"] as const,
      F148OutboundPlatformEventWebhooksValidationError
    );
  }
}

export function verifyF148Module(): {
  featureId: typeof F148_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F148OutboundPlatformEventWebhooksEngine();
  const sampleInput: F148OutboundPlatformEventWebhooksInput = {
    requestId: "req_verify_f148",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    webhook_id: "f148_webhook_id_seed",
    event_topic: 42,
    hmac_signature: true,
    delivery_http_status: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 148 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F148" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_webhook_id !== sampleInput.webhook_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F148_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
