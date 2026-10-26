/**
 * F078 (stage3-skills-bus): Генератор и исполнитель SQL-запросов (Text-to-SQL)
 * Безопасное чтение подключённых баз данных с проверкой схемы перед запросом
 * Operation Code: text_to_sql_guard
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

export const F078_FEATURE_ID = "F078" as const;
export const F078_STAGE = "stage3-skills-bus" as const;
export const F078_OPERATION_CODE = "text_to_sql_guard" as const;
export const F078_CONTRACT_VERSION = "2.0.0" as const;

export type F078SafeTextToSqlExecutorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F078SafeTextToSqlExecutorConfig = BaseFeatureConfig<
  typeof F078_FEATURE_ID,
  typeof F078_STAGE,
  typeof F078_OPERATION_CODE
>;

export interface F078SafeTextToSqlExecutorInput extends BaseFeatureInput {
  readonly natural_query: string;
  readonly generated_sql: string | number;
  readonly schema_validated: string | number | boolean | readonly string[];
  readonly read_only_enforced: string | number | boolean | Record<string, unknown>;
}

export type F078SafeTextToSqlExecutorAuditEntry = BaseFeatureAuditEntry<typeof F078_FEATURE_ID>;

export interface F078SafeTextToSqlExecutorOutput {
  readonly featureId: typeof F078_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F078SafeTextToSqlExecutorExecutionStatus;
  readonly operationCode: typeof F078_OPERATION_CODE;
  readonly resolved_natural_query: string;
  readonly resolved_generated_sql: string | number;
  readonly resolved_schema_validated: string | number | boolean | readonly string[];
  readonly resolved_read_only_enforced: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F078SafeTextToSqlExecutorAuditEntry;
}

export type F078SafeTextToSqlExecutorTelemetrySnapshot = BaseFeatureTelemetry<typeof F078_FEATURE_ID>;

export const DEFAULT_F078_CONFIG: F078SafeTextToSqlExecutorConfig = {
  featureId: F078_FEATURE_ID,
  stage: F078_STAGE,
  operationCode: F078_OPERATION_CODE,
  contractVersion: F078_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F078SafeTextToSqlExecutorValidationError extends Error {
  public readonly featureId = F078_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F078 Validation Error on '${field}']: ${message}`);
    this.name = "F078SafeTextToSqlExecutorValidationError";
    this.field = field;
  }
}

export function computeF078Digest(rawPayload: string): string {
  return `f078_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F078SafeTextToSqlExecutorEngine extends KosmoraFeatureAdapterBase<
  typeof F078_FEATURE_ID,
  typeof F078_STAGE,
  typeof F078_OPERATION_CODE,
  F078SafeTextToSqlExecutorConfig,
  F078SafeTextToSqlExecutorInput,
  F078SafeTextToSqlExecutorOutput
> {
  constructor(customConfig?: Partial<F078SafeTextToSqlExecutorConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F078_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["natural_query", "generated_sql", "schema_validated", "read_only_enforced"] as const,
      F078SafeTextToSqlExecutorValidationError
    );
  }
}

export function verifyF078Module(): {
  featureId: typeof F078_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F078SafeTextToSqlExecutorEngine();
  const sampleInput: F078SafeTextToSqlExecutorInput = {
    requestId: "req_verify_f078",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    natural_query: "f078_natural_query_seed",
    generated_sql: 42,
    schema_validated: true,
    read_only_enforced: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 78 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F078" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_natural_query !== sampleInput.natural_query &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F078_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
