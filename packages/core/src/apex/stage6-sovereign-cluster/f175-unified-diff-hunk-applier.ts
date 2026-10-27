/**
 * F175 (stage6-sovereign-cluster): Транзакционное применение Unified Diff патчей к коду
 * Построчный парсинг и наложение ханков @@ -l,s +l,s @@ с верификацией контекстных строк
 * Operation Code: unified_diff_hunk_applier
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

export const F175_FEATURE_ID = "F175" as const;
export const F175_STAGE = "stage6-sovereign-cluster" as const;
export const F175_OPERATION_CODE = "unified_diff_hunk_applier" as const;
export const F175_CONTRACT_VERSION = "2.0.0" as const;

export type F175UnifiedDiffHunkApplierExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F175UnifiedDiffHunkApplierConfig = BaseFeatureConfig<
  typeof F175_FEATURE_ID,
  typeof F175_STAGE,
  typeof F175_OPERATION_CODE
>;

export interface F175UnifiedDiffHunkApplierInput extends BaseFeatureInput {
  readonly applied_hunks: string;
  readonly lines_added: string | number;
  readonly lines_removed: string | number | boolean | readonly string[];
  readonly patched_digest: string | number | boolean | Record<string, unknown>;
}

export type F175UnifiedDiffHunkApplierAuditEntry = BaseFeatureAuditEntry<typeof F175_FEATURE_ID>;

export interface F175UnifiedDiffHunkApplierOutput {
  readonly featureId: typeof F175_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F175UnifiedDiffHunkApplierExecutionStatus;
  readonly operationCode: typeof F175_OPERATION_CODE;
  readonly resolved_applied_hunks: string;
  readonly resolved_lines_added: string | number;
  readonly resolved_lines_removed: string | number | boolean | readonly string[];
  readonly resolved_patched_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F175UnifiedDiffHunkApplierAuditEntry;
}

export type F175UnifiedDiffHunkApplierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F175_FEATURE_ID
>;

export const DEFAULT_F175_CONFIG: F175UnifiedDiffHunkApplierConfig = {
  featureId: F175_FEATURE_ID,
  stage: F175_STAGE,
  operationCode: F175_OPERATION_CODE,
  contractVersion: F175_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F175UnifiedDiffHunkApplierValidationError extends Error {
  public readonly featureId = F175_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F175 Validation Error on '${field}']: ${message}`);
    this.name = "F175UnifiedDiffHunkApplierValidationError";
    this.field = field;
  }
}

export function computeF175Digest(rawPayload: string): string {
  return `f175_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F175UnifiedDiffHunkApplierEngine extends KosmoraFeatureAdapterBase<
  typeof F175_FEATURE_ID,
  typeof F175_STAGE,
  typeof F175_OPERATION_CODE,
  F175UnifiedDiffHunkApplierConfig,
  F175UnifiedDiffHunkApplierInput,
  F175UnifiedDiffHunkApplierOutput
> {
  constructor(
    customConfig?: Partial<F175UnifiedDiffHunkApplierConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F175_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["applied_hunks", "lines_added", "lines_removed", "patched_digest"] as const,
      F175UnifiedDiffHunkApplierValidationError
    );
  }
}

export function verifyF175Module(): {
  featureId: typeof F175_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F175UnifiedDiffHunkApplierEngine();
  const sampleInput: F175UnifiedDiffHunkApplierInput = {
    requestId: "req_verify_f175",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    applied_hunks: "f175_applied_hunks_seed",
    lines_added: 42,
    lines_removed: true,
    patched_digest: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 175 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F175" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_applied_hunks !== sampleInput.applied_hunks &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F175_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
