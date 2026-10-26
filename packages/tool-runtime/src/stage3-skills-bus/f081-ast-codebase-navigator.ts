/**
 * F081 (stage3-skills-bus): Анализатор кодовой базы (AST Codebase Navigation)
 * Поиск определений функций, классов и зависимостей по дереву синтаксиса репозитория
 * Operation Code: ast_symbol_indexer
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

export const F081_FEATURE_ID = "F081" as const;
export const F081_STAGE = "stage3-skills-bus" as const;
export const F081_OPERATION_CODE = "ast_symbol_indexer" as const;
export const F081_CONTRACT_VERSION = "2.0.0" as const;

export type F081AstCodebaseNavigatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F081AstCodebaseNavigatorConfig = BaseFeatureConfig<
  typeof F081_FEATURE_ID,
  typeof F081_STAGE,
  typeof F081_OPERATION_CODE
>;

export interface F081AstCodebaseNavigatorInput extends BaseFeatureInput {
  readonly file_path: string;
  readonly exported_symbols: string | number;
  readonly import_dependencies: string | number | boolean | readonly string[];
  readonly ast_depth: string | number | boolean | Record<string, unknown>;
}

export type F081AstCodebaseNavigatorAuditEntry = BaseFeatureAuditEntry<typeof F081_FEATURE_ID>;

export interface F081AstCodebaseNavigatorOutput {
  readonly featureId: typeof F081_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F081AstCodebaseNavigatorExecutionStatus;
  readonly operationCode: typeof F081_OPERATION_CODE;
  readonly resolved_file_path: string;
  readonly resolved_exported_symbols: string | number;
  readonly resolved_import_dependencies: string | number | boolean | readonly string[];
  readonly resolved_ast_depth: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F081AstCodebaseNavigatorAuditEntry;
}

export type F081AstCodebaseNavigatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F081_FEATURE_ID>;

export const DEFAULT_F081_CONFIG: F081AstCodebaseNavigatorConfig = {
  featureId: F081_FEATURE_ID,
  stage: F081_STAGE,
  operationCode: F081_OPERATION_CODE,
  contractVersion: F081_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F081AstCodebaseNavigatorValidationError extends Error {
  public readonly featureId = F081_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F081 Validation Error on '${field}']: ${message}`);
    this.name = "F081AstCodebaseNavigatorValidationError";
    this.field = field;
  }
}

export function computeF081Digest(rawPayload: string): string {
  return `f081_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F081AstCodebaseNavigatorEngine extends KosmoraFeatureAdapterBase<
  typeof F081_FEATURE_ID,
  typeof F081_STAGE,
  typeof F081_OPERATION_CODE,
  F081AstCodebaseNavigatorConfig,
  F081AstCodebaseNavigatorInput,
  F081AstCodebaseNavigatorOutput
> {
  constructor(customConfig?: Partial<F081AstCodebaseNavigatorConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F081_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["file_path", "exported_symbols", "import_dependencies", "ast_depth"] as const,
      F081AstCodebaseNavigatorValidationError
    );
  }
}

export function verifyF081Module(): {
  featureId: typeof F081_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F081AstCodebaseNavigatorEngine();
  const sampleInput: F081AstCodebaseNavigatorInput = {
    requestId: "req_verify_f081",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    file_path: "f081_file_path_seed",
    exported_symbols: 42,
    import_dependencies: true,
    ast_depth: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 81 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F081" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_file_path !== sampleInput.file_path &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F081_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
