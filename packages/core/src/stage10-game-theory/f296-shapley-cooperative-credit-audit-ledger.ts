/**
 * F296 (stage10-game-theory): Аудиторский реестр кооперативной атрибуции полезности агентов
 * Неизменяемая запись дайджестов распределения Шепли для каждого завершённого графа задач
 * Operation Code: shapley_credit_ledger
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
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F296_FEATURE_ID = "F296" as const;
export const F296_STAGE = "stage10-game-theory" as const;
export const F296_OPERATION_CODE = "shapley_credit_ledger" as const;
export const F296_CONTRACT_VERSION = "2.0.0" as const;

export type F296ShapleyCooperativeCreditAuditLedgerConfig = BaseFeatureConfig<
  typeof F296_FEATURE_ID,
  typeof F296_STAGE,
  typeof F296_OPERATION_CODE
>;

export interface F296ShapleyCooperativeCreditAuditLedgerInput extends BaseFeatureInput {
  readonly dag_run_id: string | number | boolean | readonly string[];
  readonly agent_payoff_map: string | number | boolean | readonly string[];
  readonly efficiency_gap: string | number | boolean | readonly string[];
  readonly audit_signature: string | number | boolean | readonly string[];
}

export interface F296ShapleyCooperativeCreditAuditLedgerOutput {
  readonly featureId: typeof F296_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F296_OPERATION_CODE;
  readonly resolved_dag_run_id: unknown;
  readonly resolved_agent_payoff_map: unknown;
  readonly resolved_efficiency_gap: unknown;
  readonly resolved_audit_signature: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F296_FEATURE_ID>;
}

export type F296ShapleyCooperativeCreditAuditLedgerTelemetrySnapshot = BaseFeatureTelemetry<typeof F296_FEATURE_ID>;

export const DEFAULT_F296_CONFIG: F296ShapleyCooperativeCreditAuditLedgerConfig = {
  featureId: F296_FEATURE_ID,
  stage: F296_STAGE,
  operationCode: F296_OPERATION_CODE,
  contractVersion: F296_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F296ShapleyCooperativeCreditAuditLedgerValidationError extends Error {
  public readonly featureId = F296_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F296 Validation Error on '${field}']: ${message}`);
    this.name = "F296ShapleyCooperativeCreditAuditLedgerValidationError";
    this.field = field;
  }
}

export function computeF296Digest(rawPayload: string): string {
  return `f296_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F296ShapleyCooperativeCreditAuditLedgerService extends KosmoraFeatureAdapterBase<
  typeof F296_FEATURE_ID,
  typeof F296_STAGE,
  typeof F296_OPERATION_CODE,
  F296ShapleyCooperativeCreditAuditLedgerConfig,
  F296ShapleyCooperativeCreditAuditLedgerInput,
  F296ShapleyCooperativeCreditAuditLedgerOutput
> {
  constructor(customConfig?: Partial<F296ShapleyCooperativeCreditAuditLedgerConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F296_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["dag_run_id", "agent_payoff_map", "efficiency_gap", "audit_signature"] as const,
      F296ShapleyCooperativeCreditAuditLedgerValidationError
    );
  }
}

export function verifyF296Module(): {
  readonly featureId: typeof F296_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F296ShapleyCooperativeCreditAuditLedgerService();
  const sampleInput: F296ShapleyCooperativeCreditAuditLedgerInput = {
    requestId: "req_verify_f296",
    projectId: "proj_kosmora_f296",
    workspaceId: "ws_kosmora_f296",
    tenantId: "tenant_rlm_f296",
    actorId: "actor_verifier_f296",
    autonomyLevel: "A3",
    dag_run_id: "seed_f296_dag_run_id",
    agent_payoff_map: 42,
    efficiency_gap: true,
    audit_signature: "seed_f296_audit_signature",
    metadata: { stage: "stage10-game-theory", featureId: "F296" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F296" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_dag_run_id !== sampleInput.dag_run_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F296] Verification failed`);
  }

  return {
    featureId: F296_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
