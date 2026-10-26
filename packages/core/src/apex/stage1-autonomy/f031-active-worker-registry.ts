/**
 * F031 (stage1-autonomy): Реестр активных воркеров (Agent Registry)
 * Мониторинг живых процессов, их загрузки и текущих задач в реальном времени
 * Operation Code: worker_registry
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

export const F031_FEATURE_ID = "F031" as const;
export const F031_STAGE = "stage1-autonomy" as const;
export const F031_OPERATION_CODE = "worker_registry" as const;
export const F031_CONTRACT_VERSION = "2.0.0" as const;

export type F031ActiveWorkerRegistryExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F031ActiveWorkerRegistryConfig = BaseFeatureConfig<
  typeof F031_FEATURE_ID,
  typeof F031_STAGE,
  typeof F031_OPERATION_CODE
>;

export interface F031ActiveWorkerRegistryInput extends BaseFeatureInput {
  readonly instance_id: string;
  readonly assigned_role: string | number;
  readonly cpu_load_pct: string | number | boolean | readonly string[];
  readonly heartbeat_healthy: string | number | boolean | Record<string, unknown>;
}

export type F031ActiveWorkerRegistryAuditEntry = BaseFeatureAuditEntry<typeof F031_FEATURE_ID>;

export interface F031ActiveWorkerRegistryOutput {
  readonly featureId: typeof F031_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F031ActiveWorkerRegistryExecutionStatus;
  readonly operationCode: typeof F031_OPERATION_CODE;
  readonly resolved_instance_id: string;
  readonly resolved_assigned_role: string | number;
  readonly resolved_cpu_load_pct: string | number | boolean | readonly string[];
  readonly resolved_heartbeat_healthy: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F031ActiveWorkerRegistryAuditEntry;
}

export type F031ActiveWorkerRegistryTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F031_FEATURE_ID
>;

export const DEFAULT_F031_CONFIG: F031ActiveWorkerRegistryConfig = {
  featureId: F031_FEATURE_ID,
  stage: F031_STAGE,
  operationCode: F031_OPERATION_CODE,
  contractVersion: F031_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F031ActiveWorkerRegistryValidationError extends Error {
  public readonly featureId = F031_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F031 Validation Error on '${field}']: ${message}`);
    this.name = "F031ActiveWorkerRegistryValidationError";
    this.field = field;
  }
}

export function computeF031Digest(rawPayload: string): string {
  return `f031_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F031ActiveWorkerRegistryEngine extends KosmoraFeatureAdapterBase<
  typeof F031_FEATURE_ID,
  typeof F031_STAGE,
  typeof F031_OPERATION_CODE,
  F031ActiveWorkerRegistryConfig,
  F031ActiveWorkerRegistryInput,
  F031ActiveWorkerRegistryOutput
> {
  constructor(
    customConfig?: Partial<F031ActiveWorkerRegistryConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F031_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["instance_id", "assigned_role", "cpu_load_pct", "heartbeat_healthy"] as const,
      F031ActiveWorkerRegistryValidationError
    );
  }
}

export function verifyF031Module(): {
  featureId: typeof F031_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F031ActiveWorkerRegistryEngine();
  const sampleInput: F031ActiveWorkerRegistryInput = {
    requestId: "req_verify_f031",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    instance_id: "f031_instance_id_seed",
    assigned_role: 42,
    cpu_load_pct: true,
    heartbeat_healthy: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 31 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F031" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_instance_id !== sampleInput.instance_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F031_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
