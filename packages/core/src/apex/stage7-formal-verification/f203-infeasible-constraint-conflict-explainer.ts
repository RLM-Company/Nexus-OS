/**
 * F203 (stage7-formal-verification): Диагностика неразрешимых конфликтов ограничений (UNSAT Explainer)
 * Точное указание противоречивых правил анти-аффинности или нехватки ресурсов при невозможности размещения
 * Operation Code: infeasible_constraint_conflict_explainer
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F203_FEATURE_ID = "F203" as const;
export const F203_STAGE = "stage7-formal-verification" as const;
export const F203_OPERATION_CODE = "infeasible_constraint_conflict_explainer" as const;
export const F203_CONTRACT_VERSION = "2.0.0" as const;

export type F203InfeasibleConstraintConflictExplainerConfig = BaseFeatureConfig<
  typeof F203_FEATURE_ID,
  typeof F203_STAGE,
  typeof F203_OPERATION_CODE
>;

export interface F203InfeasibleConstraintConflictExplainerInput extends BaseFeatureInput {
  readonly feasible: string | number | boolean | readonly string[];
  readonly conflict_detected: string | number | boolean | readonly string[];
  readonly unsat_reason: string | number | boolean | readonly string[];
  readonly diagnostic_digest: string | number | boolean | readonly string[];
}

export interface F203InfeasibleConstraintConflictExplainerOutput {
  readonly featureId: typeof F203_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F203_OPERATION_CODE;
  readonly resolved_feasible: unknown;
  readonly resolved_conflict_detected: unknown;
  readonly resolved_unsat_reason: unknown;
  readonly resolved_diagnostic_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F203_FEATURE_ID>;
}

export type F203InfeasibleConstraintConflictExplainerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F203_FEATURE_ID
>;

export const DEFAULT_F203_CONFIG: F203InfeasibleConstraintConflictExplainerConfig = {
  featureId: F203_FEATURE_ID,
  stage: F203_STAGE,
  operationCode: F203_OPERATION_CODE,
  contractVersion: F203_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F203InfeasibleConstraintConflictExplainerValidationError extends Error {
  public readonly featureId = F203_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F203 Validation Error on '${field}']: ${message}`);
    this.name = "F203InfeasibleConstraintConflictExplainerValidationError";
    this.field = field;
  }
}

export function computeF203Digest(rawPayload: string): string {
  return `f203_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F203InfeasibleConstraintConflictExplainerService extends KosmoraFeatureAdapterBase<
  typeof F203_FEATURE_ID,
  typeof F203_STAGE,
  typeof F203_OPERATION_CODE,
  F203InfeasibleConstraintConflictExplainerConfig,
  F203InfeasibleConstraintConflictExplainerInput,
  F203InfeasibleConstraintConflictExplainerOutput
> {
  constructor(
    customConfig?: Partial<F203InfeasibleConstraintConflictExplainerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F203_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["feasible", "conflict_detected", "unsat_reason", "diagnostic_digest"] as const,
      F203InfeasibleConstraintConflictExplainerValidationError
    );
  }
}

export function verifyF203Module(): {
  readonly featureId: typeof F203_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F203InfeasibleConstraintConflictExplainerService();
  const sampleInput: F203InfeasibleConstraintConflictExplainerInput = {
    requestId: "req_verify_f203",
    projectId: "proj_kosmora_f203",
    workspaceId: "ws_kosmora_f203",
    tenantId: "tenant_rlm_f203",
    actorId: "actor_verifier_f203",
    autonomyLevel: "A3",
    feasible: "seed_f203_feasible",
    conflict_detected: 42,
    unsat_reason: true,
    diagnostic_digest: "seed_f203_diagnostic_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F203" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F203" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_feasible !== sampleInput.feasible &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F203] Verification failed`);
  }

  return {
    featureId: F203_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
