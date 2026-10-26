/**
 * F140 (stage5-enterprise): Поддержка собственных ключей и локальных моделей (BYOK & Local LLM)
 * Возможность подключить корпоративные эндпоинты или локальные модели для закрытого контура
 * Operation Code: byok_endpoint_router
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

export const F140_FEATURE_ID = "F140" as const;
export const F140_STAGE = "stage5-enterprise" as const;
export const F140_OPERATION_CODE = "byok_endpoint_router" as const;
export const F140_CONTRACT_VERSION = "2.0.0" as const;

export type F140ByokLocalLlmConnectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F140ByokLocalLlmConnectorConfig = BaseFeatureConfig<
  typeof F140_FEATURE_ID,
  typeof F140_STAGE,
  typeof F140_OPERATION_CODE
>;

export interface F140ByokLocalLlmConnectorInput extends BaseFeatureInput {
  readonly tenant_id: string;
  readonly custom_endpoint_url: string | number;
  readonly airgapped_mode: string | number | boolean | readonly string[];
  readonly handshake_verified: string | number | boolean | Record<string, unknown>;
}

export type F140ByokLocalLlmConnectorAuditEntry = BaseFeatureAuditEntry<typeof F140_FEATURE_ID>;

export interface F140ByokLocalLlmConnectorOutput {
  readonly featureId: typeof F140_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F140ByokLocalLlmConnectorExecutionStatus;
  readonly operationCode: typeof F140_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_custom_endpoint_url: string | number;
  readonly resolved_airgapped_mode: string | number | boolean | readonly string[];
  readonly resolved_handshake_verified: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F140ByokLocalLlmConnectorAuditEntry;
}

export type F140ByokLocalLlmConnectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F140_FEATURE_ID>;

export const DEFAULT_F140_CONFIG: F140ByokLocalLlmConnectorConfig = {
  featureId: F140_FEATURE_ID,
  stage: F140_STAGE,
  operationCode: F140_OPERATION_CODE,
  contractVersion: F140_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F140ByokLocalLlmConnectorValidationError extends Error {
  public readonly featureId = F140_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F140 Validation Error on '${field}']: ${message}`);
    this.name = "F140ByokLocalLlmConnectorValidationError";
    this.field = field;
  }
}

export function computeF140Digest(rawPayload: string): string {
  return `f140_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F140ByokLocalLlmConnectorEngine extends KosmoraFeatureAdapterBase<
  typeof F140_FEATURE_ID,
  typeof F140_STAGE,
  typeof F140_OPERATION_CODE,
  F140ByokLocalLlmConnectorConfig,
  F140ByokLocalLlmConnectorInput,
  F140ByokLocalLlmConnectorOutput
> {
  constructor(customConfig?: Partial<F140ByokLocalLlmConnectorConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F140_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["tenant_id", "custom_endpoint_url", "airgapped_mode", "handshake_verified"] as const,
      F140ByokLocalLlmConnectorValidationError
    );
  }
}

export function verifyF140Module(): {
  featureId: typeof F140_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F140ByokLocalLlmConnectorEngine();
  const sampleInput: F140ByokLocalLlmConnectorInput = {
    requestId: "req_verify_f140",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f140_tenant_id_seed",
    custom_endpoint_url: 42,
    airgapped_mode: true,
    handshake_verified: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 140 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F140" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F140_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
