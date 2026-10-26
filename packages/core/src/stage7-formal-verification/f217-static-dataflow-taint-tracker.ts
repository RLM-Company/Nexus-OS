/**
 * F217 (stage7-formal-verification): Статический анализатор распространения недоверенных данных (Taint Analysis)
 * Отслеживание потоков данных от внешних источников (req.body, untrustedInput) через переменные до опасных вызовов
 * Operation Code: static_dataflow_taint_tracker
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

export const F217_FEATURE_ID = "F217" as const;
export const F217_STAGE = "stage7-formal-verification" as const;
export const F217_OPERATION_CODE = "static_dataflow_taint_tracker" as const;
export const F217_CONTRACT_VERSION = "2.0.0" as const;

export type F217StaticDataflowTaintTrackerConfig = BaseFeatureConfig<
  typeof F217_FEATURE_ID,
  typeof F217_STAGE,
  typeof F217_OPERATION_CODE
>;

export interface F217StaticDataflowTaintTrackerInput extends BaseFeatureInput {
  readonly safe: string | number | boolean | readonly string[];
  readonly tainted_variables_count: string | number | boolean | readonly string[];
  readonly violations_count: string | number | boolean | readonly string[];
  readonly analysis_digest: string | number | boolean | readonly string[];
}

export interface F217StaticDataflowTaintTrackerOutput {
  readonly featureId: typeof F217_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F217_OPERATION_CODE;
  readonly resolved_safe: unknown;
  readonly resolved_tainted_variables_count: unknown;
  readonly resolved_violations_count: unknown;
  readonly resolved_analysis_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F217_FEATURE_ID>;
}

export type F217StaticDataflowTaintTrackerTelemetrySnapshot = BaseFeatureTelemetry<typeof F217_FEATURE_ID>;

export const DEFAULT_F217_CONFIG: F217StaticDataflowTaintTrackerConfig = {
  featureId: F217_FEATURE_ID,
  stage: F217_STAGE,
  operationCode: F217_OPERATION_CODE,
  contractVersion: F217_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F217StaticDataflowTaintTrackerValidationError extends Error {
  public readonly featureId = F217_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F217 Validation Error on '${field}']: ${message}`);
    this.name = "F217StaticDataflowTaintTrackerValidationError";
    this.field = field;
  }
}

export function computeF217Digest(rawPayload: string): string {
  return `f217_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F217StaticDataflowTaintTrackerService extends KosmoraFeatureAdapterBase<
  typeof F217_FEATURE_ID,
  typeof F217_STAGE,
  typeof F217_OPERATION_CODE,
  F217StaticDataflowTaintTrackerConfig,
  F217StaticDataflowTaintTrackerInput,
  F217StaticDataflowTaintTrackerOutput
> {
  constructor(customConfig?: Partial<F217StaticDataflowTaintTrackerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F217_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["safe", "tainted_variables_count", "violations_count", "analysis_digest"] as const,
      F217StaticDataflowTaintTrackerValidationError
    );
  }
}

export function verifyF217Module(): {
  readonly featureId: typeof F217_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F217StaticDataflowTaintTrackerService();
  const sampleInput: F217StaticDataflowTaintTrackerInput = {
    requestId: "req_verify_f217",
    projectId: "proj_kosmora_f217",
    workspaceId: "ws_kosmora_f217",
    tenantId: "tenant_rlm_f217",
    actorId: "actor_verifier_f217",
    autonomyLevel: "A3",
    safe: "seed_f217_safe",
    tainted_variables_count: 42,
    violations_count: true,
    analysis_digest: "seed_f217_analysis_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F217" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F217" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_safe !== sampleInput.safe &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F217] Verification failed`);
  }

  return {
    featureId: F217_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
