/**
 * F201 (stage7-formal-verification): Оптимизатор упаковки задач по лимитам CPU и памяти узлов
 * Предотвращение перегрузки воркеров путём точного учёта остаточной ёмкости хостов при планировании
 * Operation Code: gpu_vram_capacity_bin_packer
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

export const F201_FEATURE_ID = "F201" as const;
export const F201_STAGE = "stage7-formal-verification" as const;
export const F201_OPERATION_CODE = "gpu_vram_capacity_bin_packer" as const;
export const F201_CONTRACT_VERSION = "2.0.0" as const;

export type F201GpuVramCapacityBinPackerConfig = BaseFeatureConfig<
  typeof F201_FEATURE_ID,
  typeof F201_STAGE,
  typeof F201_OPERATION_CODE
>;

export interface F201GpuVramCapacityBinPackerInput extends BaseFeatureInput {
  readonly host_count: string | number | boolean | readonly string[];
  readonly packed_tasks: string | number | boolean | readonly string[];
  readonly remaining_cpu_cores: string | number | boolean | readonly string[];
  readonly Remaining_mem_gb: string | number | boolean | readonly string[];
}

export interface F201GpuVramCapacityBinPackerOutput {
  readonly featureId: typeof F201_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F201_OPERATION_CODE;
  readonly resolved_host_count: unknown;
  readonly resolved_packed_tasks: unknown;
  readonly resolved_remaining_cpu_cores: unknown;
  readonly resolved_Remaining_mem_gb: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F201_FEATURE_ID>;
}

export type F201GpuVramCapacityBinPackerTelemetrySnapshot = BaseFeatureTelemetry<typeof F201_FEATURE_ID>;

export const DEFAULT_F201_CONFIG: F201GpuVramCapacityBinPackerConfig = {
  featureId: F201_FEATURE_ID,
  stage: F201_STAGE,
  operationCode: F201_OPERATION_CODE,
  contractVersion: F201_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F201GpuVramCapacityBinPackerValidationError extends Error {
  public readonly featureId = F201_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F201 Validation Error on '${field}']: ${message}`);
    this.name = "F201GpuVramCapacityBinPackerValidationError";
    this.field = field;
  }
}

export function computeF201Digest(rawPayload: string): string {
  return `f201_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F201GpuVramCapacityBinPackerService extends KosmoraFeatureAdapterBase<
  typeof F201_FEATURE_ID,
  typeof F201_STAGE,
  typeof F201_OPERATION_CODE,
  F201GpuVramCapacityBinPackerConfig,
  F201GpuVramCapacityBinPackerInput,
  F201GpuVramCapacityBinPackerOutput
> {
  constructor(customConfig?: Partial<F201GpuVramCapacityBinPackerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F201_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["host_count", "packed_tasks", "remaining_cpu_cores", "Remaining_mem_gb"] as const,
      F201GpuVramCapacityBinPackerValidationError
    );
  }
}

export function verifyF201Module(): {
  readonly featureId: typeof F201_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F201GpuVramCapacityBinPackerService();
  const sampleInput: F201GpuVramCapacityBinPackerInput = {
    requestId: "req_verify_f201",
    projectId: "proj_kosmora_f201",
    workspaceId: "ws_kosmora_f201",
    tenantId: "tenant_rlm_f201",
    actorId: "actor_verifier_f201",
    autonomyLevel: "A3",
    host_count: "seed_f201_host_count",
    packed_tasks: 42,
    remaining_cpu_cores: true,
    Remaining_mem_gb: "seed_f201_Remaining_mem_gb",
    metadata: { stage: "stage7-formal-verification", featureId: "F201" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F201" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_host_count !== sampleInput.host_count &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F201] Verification failed`);
  }

  return {
    featureId: F201_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
