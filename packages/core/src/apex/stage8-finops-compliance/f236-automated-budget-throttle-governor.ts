/**
 * F236 (stage8-finops-compliance): Губернатор автоматического квотирования при критическом прогнозе FinOps
 * Принудительное переключение графов тенанта на экономичные модели при остатке бюджета менее чем на 12 часов
 * Operation Code: automated_budget_throttle_governor
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

export const F236_FEATURE_ID = "F236" as const;
export const F236_STAGE = "stage8-finops-compliance" as const;
export const F236_OPERATION_CODE = "automated_budget_throttle_governor" as const;
export const F236_CONTRACT_VERSION = "2.0.0" as const;

export type F236AutomatedBudgetThrottleGovernorConfig = BaseFeatureConfig<
  typeof F236_FEATURE_ID,
  typeof F236_STAGE,
  typeof F236_OPERATION_CODE
>;

export interface F236AutomatedBudgetThrottleGovernorInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly alert_level: string | number | boolean | readonly string[];
  readonly throttle_activated: string | number | boolean | readonly string[];
  readonly recommended_tier: string | number | boolean | readonly string[];
}

export interface F236AutomatedBudgetThrottleGovernorOutput {
  readonly featureId: typeof F236_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F236_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_alert_level: unknown;
  readonly resolved_throttle_activated: unknown;
  readonly resolved_recommended_tier: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F236_FEATURE_ID>;
}

export type F236AutomatedBudgetThrottleGovernorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F236_FEATURE_ID
>;

export const DEFAULT_F236_CONFIG: F236AutomatedBudgetThrottleGovernorConfig = {
  featureId: F236_FEATURE_ID,
  stage: F236_STAGE,
  operationCode: F236_OPERATION_CODE,
  contractVersion: F236_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F236AutomatedBudgetThrottleGovernorValidationError extends Error {
  public readonly featureId = F236_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F236 Validation Error on '${field}']: ${message}`);
    this.name = "F236AutomatedBudgetThrottleGovernorValidationError";
    this.field = field;
  }
}

export function computeF236Digest(rawPayload: string): string {
  return `f236_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F236AutomatedBudgetThrottleGovernorService extends KosmoraFeatureAdapterBase<
  typeof F236_FEATURE_ID,
  typeof F236_STAGE,
  typeof F236_OPERATION_CODE,
  F236AutomatedBudgetThrottleGovernorConfig,
  F236AutomatedBudgetThrottleGovernorInput,
  F236AutomatedBudgetThrottleGovernorOutput
> {
  constructor(
    customConfig?: Partial<F236AutomatedBudgetThrottleGovernorConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F236_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "alert_level", "throttle_activated", "recommended_tier"] as const,
      F236AutomatedBudgetThrottleGovernorValidationError
    );
  }
}

export function verifyF236Module(): {
  readonly featureId: typeof F236_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F236AutomatedBudgetThrottleGovernorService();
  const sampleInput: F236AutomatedBudgetThrottleGovernorInput = {
    requestId: "req_verify_f236",
    projectId: "proj_kosmora_f236",
    workspaceId: "ws_kosmora_f236",
    tenantId: "tenant_rlm_f236",
    actorId: "actor_verifier_f236",
    autonomyLevel: "A3",
    tenant_id: "seed_f236_tenant_id",
    alert_level: 42,
    throttle_activated: true,
    recommended_tier: "seed_f236_recommended_tier",
    metadata: { stage: "stage8-finops-compliance", featureId: "F236" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F236" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F236] Verification failed`);
  }

  return {
    featureId: F236_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
