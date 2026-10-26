/**
 * F178 (stage6-sovereign-cluster): Пересчёт смещений строк при многоблочном патчинге
 * Корректировка координат строк при последовательном применении нескольких ханков разной длины
 * Operation Code: multi_hunk_offset_recalculator
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F178_FEATURE_ID = "F178" as const;
export const F178_STAGE = "stage6-sovereign-cluster" as const;
export const F178_OPERATION_CODE = "multi_hunk_offset_recalculator" as const;
export const F178_CONTRACT_VERSION = "2.0.0" as const;

export type F178MultiHunkOffsetRecalculatorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F178MultiHunkOffsetRecalculatorConfig = BaseFeatureConfig<
  typeof F178_FEATURE_ID,
  typeof F178_STAGE,
  typeof F178_OPERATION_CODE
>;

export interface F178MultiHunkOffsetRecalculatorInput extends BaseFeatureInput {
  readonly applied_hunks: string;
  readonly net_line_offset: string | number;
  readonly original_digest: string | number | boolean | readonly string[];
  readonly patched_digest: string | number | boolean | Record<string, unknown>;
}

export type F178MultiHunkOffsetRecalculatorAuditEntry = BaseFeatureAuditEntry<
  typeof F178_FEATURE_ID
>;

export interface F178MultiHunkOffsetRecalculatorOutput {
  readonly featureId: typeof F178_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F178MultiHunkOffsetRecalculatorExecutionStatus;
  readonly operationCode: typeof F178_OPERATION_CODE;
  readonly resolved_applied_hunks: string;
  readonly resolved_net_line_offset: string | number;
  readonly resolved_original_digest: string | number | boolean | readonly string[];
  readonly resolved_patched_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F178MultiHunkOffsetRecalculatorAuditEntry;
}

export type F178MultiHunkOffsetRecalculatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F178_FEATURE_ID
>;

export const DEFAULT_F178_CONFIG: F178MultiHunkOffsetRecalculatorConfig = {
  featureId: F178_FEATURE_ID,
  stage: F178_STAGE,
  operationCode: F178_OPERATION_CODE,
  contractVersion: F178_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F178MultiHunkOffsetRecalculatorValidationError extends Error {
  public readonly featureId = F178_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F178 Validation Error on '${field}']: ${message}`);
    this.name = "F178MultiHunkOffsetRecalculatorValidationError";
    this.field = field;
  }
}

export function computeF178Digest(rawPayload: string): string {
  return `f178_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F178MultiHunkOffsetRecalculatorEngine extends KosmoraFeatureAdapterBase<
  typeof F178_FEATURE_ID,
  typeof F178_STAGE,
  typeof F178_OPERATION_CODE,
  F178MultiHunkOffsetRecalculatorConfig,
  F178MultiHunkOffsetRecalculatorInput,
  F178MultiHunkOffsetRecalculatorOutput
> {
  constructor(
    customConfig?: Partial<F178MultiHunkOffsetRecalculatorConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F178_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["applied_hunks", "net_line_offset", "original_digest", "patched_digest"] as const,
      F178MultiHunkOffsetRecalculatorValidationError
    );
  }
}

export function verifyF178Module(): {
  featureId: typeof F178_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F178MultiHunkOffsetRecalculatorEngine();
  const sampleInput: F178MultiHunkOffsetRecalculatorInput = {
    requestId: "req_verify_f178",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    applied_hunks: "f178_applied_hunks_seed",
    net_line_offset: 42,
    original_digest: true,
    patched_digest: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 178 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F178" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_applied_hunks !== sampleInput.applied_hunks &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F178_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
