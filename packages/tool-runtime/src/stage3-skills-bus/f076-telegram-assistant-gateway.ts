/**
 * F076 (stage3-skills-bus): Шлюз Telegram-ассистента
 * Управление задачами Nexus-OS, получение уведомлений и аппрув чекпоинтов через Telegram
 * Operation Code: telegram_bot_bridge
 */

import { createHash } from "node:crypto";
import {
  Stage3SkillsKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F076_FEATURE_ID = "F076" as const;
export const F076_STAGE = "stage3-skills-bus" as const;
export const F076_OPERATION_CODE = "telegram_bot_bridge" as const;
export const F076_CONTRACT_VERSION = "2.0.0" as const;

export type F076TelegramAssistantGatewayExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F076TelegramAssistantGatewayConfig = BaseFeatureConfig<
  typeof F076_FEATURE_ID,
  typeof F076_STAGE,
  typeof F076_OPERATION_CODE
>;

export interface F076TelegramAssistantGatewayInput extends BaseFeatureInput {
  readonly chat_id: string;
  readonly notification_kind: string | number;
  readonly inline_approval_callback: string | number | boolean | readonly string[];
  readonly delivered_ok: string | number | boolean | Record<string, unknown>;
}

export type F076TelegramAssistantGatewayAuditEntry = BaseFeatureAuditEntry<typeof F076_FEATURE_ID>;

export interface F076TelegramAssistantGatewayOutput {
  readonly featureId: typeof F076_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F076TelegramAssistantGatewayExecutionStatus;
  readonly operationCode: typeof F076_OPERATION_CODE;
  readonly resolved_chat_id: string;
  readonly resolved_notification_kind: string | number;
  readonly resolved_inline_approval_callback: string | number | boolean | readonly string[];
  readonly resolved_delivered_ok: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F076TelegramAssistantGatewayAuditEntry;
}

export type F076TelegramAssistantGatewayTelemetrySnapshot = BaseFeatureTelemetry<typeof F076_FEATURE_ID>;

export const DEFAULT_F076_CONFIG: F076TelegramAssistantGatewayConfig = {
  featureId: F076_FEATURE_ID,
  stage: F076_STAGE,
  operationCode: F076_OPERATION_CODE,
  contractVersion: F076_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F076TelegramAssistantGatewayValidationError extends Error {
  public readonly featureId = F076_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F076 Validation Error on '${field}']: ${message}`);
    this.name = "F076TelegramAssistantGatewayValidationError";
    this.field = field;
  }
}

export function computeF076Digest(rawPayload: string): string {
  return `f076_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F076TelegramAssistantGatewayEngine extends KosmoraFeatureAdapterBase<
  typeof F076_FEATURE_ID,
  typeof F076_STAGE,
  typeof F076_OPERATION_CODE,
  F076TelegramAssistantGatewayConfig,
  F076TelegramAssistantGatewayInput,
  F076TelegramAssistantGatewayOutput
> {
  constructor(customConfig?: Partial<F076TelegramAssistantGatewayConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F076_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["chat_id", "notification_kind", "inline_approval_callback", "delivered_ok"] as const,
      F076TelegramAssistantGatewayValidationError
    );
  }
}

export function verifyF076Module(): {
  featureId: typeof F076_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F076TelegramAssistantGatewayEngine();
  const sampleInput: F076TelegramAssistantGatewayInput = {
    requestId: "req_verify_f076",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    chat_id: "f076_chat_id_seed",
    notification_kind: 42,
    inline_approval_callback: true,
    delivered_ok: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 76 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F076" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_chat_id !== sampleInput.chat_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F076_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
