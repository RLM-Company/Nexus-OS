/**
 * F074 (stage3-skills-bus): Исполнение Python-скриптов в контролируемой среде
 * Запуск расчётов, pandas-аналитики и построения графиков в изолированном рантайме
 * Operation Code: python_sandbox_executor
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

export const F074_FEATURE_ID = "F074" as const;
export const F074_STAGE = "stage3-skills-bus" as const;
export const F074_OPERATION_CODE = "python_sandbox_executor" as const;
export const F074_CONTRACT_VERSION = "2.0.0" as const;

export type F074ControlledPythonRuntimeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F074ControlledPythonRuntimeConfig = BaseFeatureConfig<
  typeof F074_FEATURE_ID,
  typeof F074_STAGE,
  typeof F074_OPERATION_CODE
>;

export interface F074ControlledPythonRuntimeInput extends BaseFeatureInput {
  readonly execution_id: string;
  readonly script_hash: string | number;
  readonly exit_code: string | number | boolean | readonly string[];
  readonly captured_stdout: string | number | boolean | Record<string, unknown>;
}

export type F074ControlledPythonRuntimeAuditEntry = BaseFeatureAuditEntry<typeof F074_FEATURE_ID>;

export interface F074ControlledPythonRuntimeOutput {
  readonly featureId: typeof F074_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F074ControlledPythonRuntimeExecutionStatus;
  readonly operationCode: typeof F074_OPERATION_CODE;
  readonly resolved_execution_id: string;
  readonly resolved_script_hash: string | number;
  readonly resolved_exit_code: string | number | boolean | readonly string[];
  readonly resolved_captured_stdout: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F074ControlledPythonRuntimeAuditEntry;
}

export type F074ControlledPythonRuntimeTelemetrySnapshot = BaseFeatureTelemetry<typeof F074_FEATURE_ID>;

export const DEFAULT_F074_CONFIG: F074ControlledPythonRuntimeConfig = {
  featureId: F074_FEATURE_ID,
  stage: F074_STAGE,
  operationCode: F074_OPERATION_CODE,
  contractVersion: F074_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F074ControlledPythonRuntimeValidationError extends Error {
  public readonly featureId = F074_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F074 Validation Error on '${field}']: ${message}`);
    this.name = "F074ControlledPythonRuntimeValidationError";
    this.field = field;
  }
}

export function computeF074Digest(rawPayload: string): string {
  return `f074_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F074ControlledPythonRuntimeEngine extends KosmoraFeatureAdapterBase<
  typeof F074_FEATURE_ID,
  typeof F074_STAGE,
  typeof F074_OPERATION_CODE,
  F074ControlledPythonRuntimeConfig,
  F074ControlledPythonRuntimeInput,
  F074ControlledPythonRuntimeOutput
> {
  constructor(customConfig?: Partial<F074ControlledPythonRuntimeConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F074_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["execution_id", "script_hash", "exit_code", "captured_stdout"] as const,
      F074ControlledPythonRuntimeValidationError
    );
  }
}

export function verifyF074Module(): {
  featureId: typeof F074_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F074ControlledPythonRuntimeEngine();
  const sampleInput: F074ControlledPythonRuntimeInput = {
    requestId: "req_verify_f074",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    execution_id: "f074_execution_id_seed",
    script_hash: 42,
    exit_code: true,
    captured_stdout: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 74 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F074" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_execution_id !== sampleInput.execution_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F074_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
