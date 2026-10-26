/**
 * F238 (stage8-finops-compliance): Бухгалтерская книга учёта расхода бюджета приватности (Privacy Loss Accountant)
 * Строгий учёт накопленных параметров ε и δ по каждому аналитическому запросу к данным тенанта
 * Operation Code: privacy_budget_accountant_ledger
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

export const F238_FEATURE_ID = "F238" as const;
export const F238_STAGE = "stage8-finops-compliance" as const;
export const F238_OPERATION_CODE = "privacy_budget_accountant_ledger" as const;
export const F238_CONTRACT_VERSION = "2.0.0" as const;

export type F238PrivacyBudgetAccountantLedgerConfig = BaseFeatureConfig<
  typeof F238_FEATURE_ID,
  typeof F238_STAGE,
  typeof F238_OPERATION_CODE
>;

export interface F238PrivacyBudgetAccountantLedgerInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly epsilon_consumed: string | number | boolean | readonly string[];
  readonly remaining_epsilon: string | number | boolean | readonly string[];
  readonly remaining_delta: string | number | boolean | readonly string[];
}

export interface F238PrivacyBudgetAccountantLedgerOutput {
  readonly featureId: typeof F238_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F238_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_epsilon_consumed: unknown;
  readonly resolved_remaining_epsilon: unknown;
  readonly resolved_remaining_delta: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F238_FEATURE_ID>;
}

export type F238PrivacyBudgetAccountantLedgerTelemetrySnapshot = BaseFeatureTelemetry<typeof F238_FEATURE_ID>;

export const DEFAULT_F238_CONFIG: F238PrivacyBudgetAccountantLedgerConfig = {
  featureId: F238_FEATURE_ID,
  stage: F238_STAGE,
  operationCode: F238_OPERATION_CODE,
  contractVersion: F238_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F238PrivacyBudgetAccountantLedgerValidationError extends Error {
  public readonly featureId = F238_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F238 Validation Error on '${field}']: ${message}`);
    this.name = "F238PrivacyBudgetAccountantLedgerValidationError";
    this.field = field;
  }
}

export function computeF238Digest(rawPayload: string): string {
  return `f238_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F238PrivacyBudgetAccountantLedgerService extends KosmoraFeatureAdapterBase<
  typeof F238_FEATURE_ID,
  typeof F238_STAGE,
  typeof F238_OPERATION_CODE,
  F238PrivacyBudgetAccountantLedgerConfig,
  F238PrivacyBudgetAccountantLedgerInput,
  F238PrivacyBudgetAccountantLedgerOutput
> {
  constructor(customConfig?: Partial<F238PrivacyBudgetAccountantLedgerConfig>, kernel?: Stage8FinOpsKernel) {
    super(
      DEFAULT_F238_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "epsilon_consumed", "remaining_epsilon", "remaining_delta"] as const,
      F238PrivacyBudgetAccountantLedgerValidationError
    );
  }
}

export function verifyF238Module(): {
  readonly featureId: typeof F238_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F238PrivacyBudgetAccountantLedgerService();
  const sampleInput: F238PrivacyBudgetAccountantLedgerInput = {
    requestId: "req_verify_f238",
    projectId: "proj_kosmora_f238",
    workspaceId: "ws_kosmora_f238",
    tenantId: "tenant_rlm_f238",
    actorId: "actor_verifier_f238",
    autonomyLevel: "A3",
    tenant_id: "seed_f238_tenant_id",
    epsilon_consumed: 42,
    remaining_epsilon: true,
    remaining_delta: "seed_f238_remaining_delta",
    metadata: { stage: "stage8-finops-compliance", featureId: "F238" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F238" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F238] Verification failed`);
  }

  return {
    featureId: F238_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
