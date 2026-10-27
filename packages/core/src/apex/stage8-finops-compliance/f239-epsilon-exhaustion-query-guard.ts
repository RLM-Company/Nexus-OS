/**
 * F239 (stage8-finops-compliance): Блокировщик аналитических запросов при исчерпании лимита дифференциальной приватности
 * Предотвращение реконструкции персональных данных путём отказа в выдаче агрегатов сверх квоты ε
 * Operation Code: epsilon_exhaustion_query_guard
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

export const F239_FEATURE_ID = "F239" as const;
export const F239_STAGE = "stage8-finops-compliance" as const;
export const F239_OPERATION_CODE = "epsilon_exhaustion_query_guard" as const;
export const F239_CONTRACT_VERSION = "2.0.0" as const;

export type F239EpsilonExhaustionQueryGuardConfig = BaseFeatureConfig<
  typeof F239_FEATURE_ID,
  typeof F239_STAGE,
  typeof F239_OPERATION_CODE
>;

export interface F239EpsilonExhaustionQueryGuardInput extends BaseFeatureInput {
  readonly tenant_id: string | number | boolean | readonly string[];
  readonly first_query_allowed: string | number | boolean | readonly string[];
  readonly exhausted_query_blocked: string | number | boolean | readonly string[];
  readonly remaining_epsilon: string | number | boolean | readonly string[];
}

export interface F239EpsilonExhaustionQueryGuardOutput {
  readonly featureId: typeof F239_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F239_OPERATION_CODE;
  readonly resolved_tenant_id: unknown;
  readonly resolved_first_query_allowed: unknown;
  readonly resolved_exhausted_query_blocked: unknown;
  readonly resolved_remaining_epsilon: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F239_FEATURE_ID>;
}

export type F239EpsilonExhaustionQueryGuardTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F239_FEATURE_ID
>;

export const DEFAULT_F239_CONFIG: F239EpsilonExhaustionQueryGuardConfig = {
  featureId: F239_FEATURE_ID,
  stage: F239_STAGE,
  operationCode: F239_OPERATION_CODE,
  contractVersion: F239_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F239EpsilonExhaustionQueryGuardValidationError extends Error {
  public readonly featureId = F239_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F239 Validation Error on '${field}']: ${message}`);
    this.name = "F239EpsilonExhaustionQueryGuardValidationError";
    this.field = field;
  }
}

export function computeF239Digest(rawPayload: string): string {
  return `f239_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F239EpsilonExhaustionQueryGuardService extends KosmoraFeatureAdapterBase<
  typeof F239_FEATURE_ID,
  typeof F239_STAGE,
  typeof F239_OPERATION_CODE,
  F239EpsilonExhaustionQueryGuardConfig,
  F239EpsilonExhaustionQueryGuardInput,
  F239EpsilonExhaustionQueryGuardOutput
> {
  constructor(
    customConfig?: Partial<F239EpsilonExhaustionQueryGuardConfig>,
    kernel?: Stage8FinOpsKernel
  ) {
    super(
      DEFAULT_F239_CONFIG,
      customConfig,
      kernel ?? Stage8FinOpsKernel.getShared(),
      ["tenant_id", "first_query_allowed", "exhausted_query_blocked", "remaining_epsilon"] as const,
      F239EpsilonExhaustionQueryGuardValidationError
    );
  }
}

export function verifyF239Module(): {
  readonly featureId: typeof F239_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F239EpsilonExhaustionQueryGuardService();
  const sampleInput: F239EpsilonExhaustionQueryGuardInput = {
    requestId: "req_verify_f239",
    projectId: "proj_kosmora_f239",
    workspaceId: "ws_kosmora_f239",
    tenantId: "tenant_rlm_f239",
    actorId: "actor_verifier_f239",
    autonomyLevel: "A3",
    tenant_id: "seed_f239_tenant_id",
    first_query_allowed: 42,
    exhausted_query_blocked: true,
    remaining_epsilon: "seed_f239_remaining_epsilon",
    metadata: { stage: "stage8-finops-compliance", featureId: "F239" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F239" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F239] Verification failed`);
  }

  return {
    featureId: F239_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
