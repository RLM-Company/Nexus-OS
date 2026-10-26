/**
 * F091 (stage3-skills-bus): Симулятор сухого прогона (Dry-Run Mode)
 * Показ того, какие файлы будут изменены или какие API вызваны, без фактической записи
 * Operation Code: dry_run_simulator
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

export const F091_FEATURE_ID = "F091" as const;
export const F091_STAGE = "stage3-skills-bus" as const;
export const F091_OPERATION_CODE = "dry_run_simulator" as const;
export const F091_CONTRACT_VERSION = "2.0.0" as const;

export type F091DryRunSimulationModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F091DryRunSimulationModeConfig = BaseFeatureConfig<
  typeof F091_FEATURE_ID,
  typeof F091_STAGE,
  typeof F091_OPERATION_CODE
>;

export interface F091DryRunSimulationModeInput extends BaseFeatureInput {
  readonly simulation_id: string;
  readonly planned_file_writes: string | number;
  readonly planned_api_calls: string | number | boolean | readonly string[];
  readonly zero_side_effects: string | number | boolean | Record<string, unknown>;
}

export type F091DryRunSimulationModeAuditEntry = BaseFeatureAuditEntry<typeof F091_FEATURE_ID>;

export interface F091DryRunSimulationModeOutput {
  readonly featureId: typeof F091_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F091DryRunSimulationModeExecutionStatus;
  readonly operationCode: typeof F091_OPERATION_CODE;
  readonly resolved_simulation_id: string;
  readonly resolved_planned_file_writes: string | number;
  readonly resolved_planned_api_calls: string | number | boolean | readonly string[];
  readonly resolved_zero_side_effects: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F091DryRunSimulationModeAuditEntry;
}

export type F091DryRunSimulationModeTelemetrySnapshot = BaseFeatureTelemetry<typeof F091_FEATURE_ID>;

export const DEFAULT_F091_CONFIG: F091DryRunSimulationModeConfig = {
  featureId: F091_FEATURE_ID,
  stage: F091_STAGE,
  operationCode: F091_OPERATION_CODE,
  contractVersion: F091_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F091DryRunSimulationModeValidationError extends Error {
  public readonly featureId = F091_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F091 Validation Error on '${field}']: ${message}`);
    this.name = "F091DryRunSimulationModeValidationError";
    this.field = field;
  }
}

export function computeF091Digest(rawPayload: string): string {
  return `f091_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F091DryRunSimulationModeEngine extends KosmoraFeatureAdapterBase<
  typeof F091_FEATURE_ID,
  typeof F091_STAGE,
  typeof F091_OPERATION_CODE,
  F091DryRunSimulationModeConfig,
  F091DryRunSimulationModeInput,
  F091DryRunSimulationModeOutput
> {
  constructor(customConfig?: Partial<F091DryRunSimulationModeConfig>, kernel?: Stage3SkillsKernel) {
    super(
      DEFAULT_F091_CONFIG,
      customConfig,
      kernel ?? new Stage3SkillsKernel(),
      ["simulation_id", "planned_file_writes", "planned_api_calls", "zero_side_effects"] as const,
      F091DryRunSimulationModeValidationError
    );
  }
}

export function verifyF091Module(): {
  featureId: typeof F091_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F091DryRunSimulationModeEngine();
  const sampleInput: F091DryRunSimulationModeInput = {
    requestId: "req_verify_f091",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    simulation_id: "f091_simulation_id_seed",
    planned_file_writes: 42,
    planned_api_calls: true,
    zero_side_effects: "verified_seed",
    metadata: { stage: "stage3-skills-bus", featureNumber: 91 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F091" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_simulation_id !== sampleInput.simulation_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F091_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
