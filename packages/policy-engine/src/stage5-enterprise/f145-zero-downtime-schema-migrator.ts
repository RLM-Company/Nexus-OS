/**
 * F145 (stage5-enterprise): Менеджер миграций схемы БД и графа
 * Безопасное накатывание обновлений структуры базы с поддержкой отката без простоя
 * Operation Code: schema_migration_runner
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

export const F145_FEATURE_ID = "F145" as const;
export const F145_STAGE = "stage5-enterprise" as const;
export const F145_OPERATION_CODE = "schema_migration_runner" as const;
export const F145_CONTRACT_VERSION = "2.0.0" as const;

export type F145ZeroDowntimeSchemaMigratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F145ZeroDowntimeSchemaMigratorConfig = BaseFeatureConfig<
  typeof F145_FEATURE_ID,
  typeof F145_STAGE,
  typeof F145_OPERATION_CODE
>;

export interface F145ZeroDowntimeSchemaMigratorInput extends BaseFeatureInput {
  readonly migration_version: string;
  readonly direction: string | number;
  readonly tables_migrated: string | number | boolean | readonly string[];
  readonly rollback_ready: string | number | boolean | Record<string, unknown>;
}

export type F145ZeroDowntimeSchemaMigratorAuditEntry = BaseFeatureAuditEntry<typeof F145_FEATURE_ID>;

export interface F145ZeroDowntimeSchemaMigratorOutput {
  readonly featureId: typeof F145_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F145ZeroDowntimeSchemaMigratorExecutionStatus;
  readonly operationCode: typeof F145_OPERATION_CODE;
  readonly resolved_migration_version: string;
  readonly resolved_direction: string | number;
  readonly resolved_tables_migrated: string | number | boolean | readonly string[];
  readonly resolved_rollback_ready: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F145ZeroDowntimeSchemaMigratorAuditEntry;
}

export type F145ZeroDowntimeSchemaMigratorTelemetrySnapshot = BaseFeatureTelemetry<typeof F145_FEATURE_ID>;

export const DEFAULT_F145_CONFIG: F145ZeroDowntimeSchemaMigratorConfig = {
  featureId: F145_FEATURE_ID,
  stage: F145_STAGE,
  operationCode: F145_OPERATION_CODE,
  contractVersion: F145_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F145ZeroDowntimeSchemaMigratorValidationError extends Error {
  public readonly featureId = F145_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F145 Validation Error on '${field}']: ${message}`);
    this.name = "F145ZeroDowntimeSchemaMigratorValidationError";
    this.field = field;
  }
}

export function computeF145Digest(rawPayload: string): string {
  return `f145_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F145ZeroDowntimeSchemaMigratorEngine extends KosmoraFeatureAdapterBase<
  typeof F145_FEATURE_ID,
  typeof F145_STAGE,
  typeof F145_OPERATION_CODE,
  F145ZeroDowntimeSchemaMigratorConfig,
  F145ZeroDowntimeSchemaMigratorInput,
  F145ZeroDowntimeSchemaMigratorOutput
> {
  constructor(customConfig?: Partial<F145ZeroDowntimeSchemaMigratorConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F145_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["migration_version", "direction", "tables_migrated", "rollback_ready"] as const,
      F145ZeroDowntimeSchemaMigratorValidationError
    );
  }
}

export function verifyF145Module(): {
  featureId: typeof F145_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F145ZeroDowntimeSchemaMigratorEngine();
  const sampleInput: F145ZeroDowntimeSchemaMigratorInput = {
    requestId: "req_verify_f145",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    migration_version: "f145_migration_version_seed",
    direction: 42,
    tables_migrated: true,
    rollback_ready: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 145 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F145" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_migration_version !== sampleInput.migration_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F145_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
