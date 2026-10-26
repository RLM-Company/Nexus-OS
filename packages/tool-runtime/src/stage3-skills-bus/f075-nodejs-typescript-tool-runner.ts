/**
 * F075 (stage3-skills-bus): Исполнение Node.js / TypeScript-инструментов
 * Выполнение серверных скриптов, парсеров и проверка сборки прямо из рабочей сессии
 * Operation Code: node_ts_executor
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

export const F075_FEATURE_ID = "F075" as const;
export const F075_STAGE = "stage3-skills-bus" as const;
export const F075_OPERATION_CODE = "node_ts_executor" as const;
export const F075_CONTRACT_VERSION = "2.0.0" as const;

export type F075NodejsTypescriptToolRunnerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F075NodejsTypescriptToolRunnerConfig = BaseFeatureConfig<
  typeof F075_FEATURE_ID,
  typeof F075_STAGE,
  typeof F075_OPERATION_CODE
>;

export interface F075NodejsTypescriptToolRunnerInput extends BaseFeatureInput {
  readonly execution_id: string;
  readonly ts_module_name: string | number;
  readonly typecheck_passed: string | number | boolean | readonly string[];
  readonly execution_output: string | number | boolean | Record<string, unknown>;
}

export type F075NodejsTypescriptToolRunnerAuditEntry = BaseFeatureAuditEntry<typeof F075_FEATURE_ID>;

export interface F075NodejsTypescriptToolRunnerOutput {
  readonly featureId: typeof F075_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F075NodejsTypescriptToolRunnerExecutionStatus;
  readonly operationCode: typeof F075_OPERATION_CODE;
  readonly resolved_execution_id: string;
  readonly resolved_ts_module_name: string | number;
  readonly resolved_typecheck_passed: string | number | boolean | readonly string[];
  readonly resolved_execution_output: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F075NodejsTypescriptToolRunnerAuditEntry;
}

export type F075NodejsTypescriptToolRunnerTelemetrySnapshot = BaseFeatureTelemetry<typeof F075_FEATURE_ID>;

export const DEFAULT_F075_CONFIG: F075NodejsTypescriptToolRunnerConfig = {
  featureId: F075_FEATURE_ID,
  stage: F075_STAGE,
  operationCode: F075_OPERATION_CODE,
  contractVersion: F075_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F075NodejsTypescriptToolRunnerValidationError extends Error {
  public readonly featureId = F075_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F075 Validation Error on '${field}']: ${message}`);
    this.name = "F075NodejsTypescriptToolRunnerValidationError";
    this.field = field;
  }
}

export function computeF075Digest(rawPayload: string): string {
  return `f075_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F075NodejsTypescriptToolRunnerEngine extends KosmoraFeatureAdapterBase<
  typeof F075_FEATURE_ID,
  typeof F075_STAGE,
  typeof F075_OPERATION_CODE,
  F075NodejsTypescriptToolRunnerConfig,
  F075NodejsTypescriptToolRunnerInput,
  F075NodejsTypescriptToolRunnerOutput
> {
  constructor(customConfig?: Partial<F075NodejsTypescriptToolRunnerConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F075_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["execution_id", "ts_module_name", "typecheck_passed", "execution_output"] as const,
      F075NodejsTypescriptToolRunnerValidationError
    );
  }
}

export function verifyF075Module(): {
  featureId: typeof F075_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F075NodejsTypescriptToolRunnerEngine();
  const sampleInput: F075NodejsTypescriptToolRunnerInput = {
    requestId: "req_verify_f075",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    execution_id: "f075_execution_id_seed",
    ts_module_name: 42,
    typecheck_passed: true,
    execution_output: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 75 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F075" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_execution_id !== sampleInput.execution_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F075_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
