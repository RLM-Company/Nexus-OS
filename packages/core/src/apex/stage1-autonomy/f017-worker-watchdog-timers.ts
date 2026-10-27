/**
 * F017 (stage1-autonomy): Таймауты и Watchdog-таймеры воркеров
 * Перезапуск зависших агентных процессов при превышении порога ожидания
 * Operation Code: watchdog_monitor
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F017_FEATURE_ID = "F017" as const;
export const F017_STAGE = "stage1-autonomy" as const;
export const F017_OPERATION_CODE = "watchdog_monitor" as const;
export const F017_CONTRACT_VERSION = "2.0.0" as const;

export type F017WorkerWatchdogTimersExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F017WorkerWatchdogTimersConfig = BaseFeatureConfig<
  typeof F017_FEATURE_ID,
  typeof F017_STAGE,
  typeof F017_OPERATION_CODE
>;

export interface F017WorkerWatchdogTimersInput extends BaseFeatureInput {
  readonly worker_id: string;
  readonly elapsed_ms: string | number;
  readonly timeout_limit_ms: string | number | boolean | readonly string[];
  readonly restart_triggered: string | number | boolean | Record<string, unknown>;
}

export type F017WorkerWatchdogTimersAuditEntry = BaseFeatureAuditEntry<typeof F017_FEATURE_ID>;

export interface F017WorkerWatchdogTimersOutput {
  readonly featureId: typeof F017_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F017WorkerWatchdogTimersExecutionStatus;
  readonly operationCode: typeof F017_OPERATION_CODE;
  readonly resolved_worker_id: string;
  readonly resolved_elapsed_ms: string | number;
  readonly resolved_timeout_limit_ms: string | number | boolean | readonly string[];
  readonly resolved_restart_triggered: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F017WorkerWatchdogTimersAuditEntry;
}

export type F017WorkerWatchdogTimersTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F017_FEATURE_ID
>;

export const DEFAULT_F017_CONFIG: F017WorkerWatchdogTimersConfig = {
  featureId: F017_FEATURE_ID,
  stage: F017_STAGE,
  operationCode: F017_OPERATION_CODE,
  contractVersion: F017_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F017WorkerWatchdogTimersValidationError extends Error {
  public readonly featureId = F017_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F017 Validation Error on '${field}']: ${message}`);
    this.name = "F017WorkerWatchdogTimersValidationError";
    this.field = field;
  }
}

export function computeF017Digest(rawPayload: string): string {
  return `f017_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F017WorkerWatchdogTimersEngine extends KosmoraFeatureAdapterBase<
  typeof F017_FEATURE_ID,
  typeof F017_STAGE,
  typeof F017_OPERATION_CODE,
  F017WorkerWatchdogTimersConfig,
  F017WorkerWatchdogTimersInput,
  F017WorkerWatchdogTimersOutput
> {
  constructor(
    customConfig?: Partial<F017WorkerWatchdogTimersConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F017_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["worker_id", "elapsed_ms", "timeout_limit_ms", "restart_triggered"] as const,
      F017WorkerWatchdogTimersValidationError
    );
  }
}

export function verifyF017Module(): {
  featureId: typeof F017_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F017WorkerWatchdogTimersEngine();
  const sampleInput: F017WorkerWatchdogTimersInput = {
    requestId: "req_verify_f017",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    worker_id: "f017_worker_id_seed",
    elapsed_ms: 42,
    timeout_limit_ms: true,
    restart_triggered: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 17 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F017" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_worker_id !== sampleInput.worker_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F017_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
