/**
 * F094 (stage3-skills-bus): Сравнение нескольких документов (Multi-Doc Diff & Matrix)
 * Составление сравнительной матрицы по 5–10 договорам или спецификациям
 * Operation Code: multidoc_matrix_builder
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

export const F094_FEATURE_ID = "F094" as const;
export const F094_STAGE = "stage3-skills-bus" as const;
export const F094_OPERATION_CODE = "multidoc_matrix_builder" as const;
export const F094_CONTRACT_VERSION = "2.0.0" as const;

export type F094MultidocComparisonMatrixExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F094MultidocComparisonMatrixConfig = BaseFeatureConfig<
  typeof F094_FEATURE_ID,
  typeof F094_STAGE,
  typeof F094_OPERATION_CODE
>;

export interface F094MultidocComparisonMatrixInput extends BaseFeatureInput {
  readonly matrix_id: string;
  readonly compared_docs_count: string | number;
  readonly criteria_columns: string | number | boolean | readonly string[];
  readonly discrepancies_found: string | number | boolean | Record<string, unknown>;
}

export type F094MultidocComparisonMatrixAuditEntry = BaseFeatureAuditEntry<typeof F094_FEATURE_ID>;

export interface F094MultidocComparisonMatrixOutput {
  readonly featureId: typeof F094_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F094MultidocComparisonMatrixExecutionStatus;
  readonly operationCode: typeof F094_OPERATION_CODE;
  readonly resolved_matrix_id: string;
  readonly resolved_compared_docs_count: string | number;
  readonly resolved_criteria_columns: string | number | boolean | readonly string[];
  readonly resolved_discrepancies_found: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F094MultidocComparisonMatrixAuditEntry;
}

export type F094MultidocComparisonMatrixTelemetrySnapshot = BaseFeatureTelemetry<typeof F094_FEATURE_ID>;

export const DEFAULT_F094_CONFIG: F094MultidocComparisonMatrixConfig = {
  featureId: F094_FEATURE_ID,
  stage: F094_STAGE,
  operationCode: F094_OPERATION_CODE,
  contractVersion: F094_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F094MultidocComparisonMatrixValidationError extends Error {
  public readonly featureId = F094_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F094 Validation Error on '${field}']: ${message}`);
    this.name = "F094MultidocComparisonMatrixValidationError";
    this.field = field;
  }
}

export function computeF094Digest(rawPayload: string): string {
  return `f094_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F094MultidocComparisonMatrixEngine extends KosmoraFeatureAdapterBase<
  typeof F094_FEATURE_ID,
  typeof F094_STAGE,
  typeof F094_OPERATION_CODE,
  F094MultidocComparisonMatrixConfig,
  F094MultidocComparisonMatrixInput,
  F094MultidocComparisonMatrixOutput
> {
  constructor(customConfig?: Partial<F094MultidocComparisonMatrixConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F094_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["matrix_id", "compared_docs_count", "criteria_columns", "discrepancies_found"] as const,
      F094MultidocComparisonMatrixValidationError
    );
  }
}

export function verifyF094Module(): {
  featureId: typeof F094_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F094MultidocComparisonMatrixEngine();
  const sampleInput: F094MultidocComparisonMatrixInput = {
    requestId: "req_verify_f094",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    matrix_id: "f094_matrix_id_seed",
    compared_docs_count: 42,
    criteria_columns: true,
    discrepancies_found: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 94 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F094" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_matrix_id !== sampleInput.matrix_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F094_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
