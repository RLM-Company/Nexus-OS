/**
 * F113 (stage4-intelligence-graph): Изоляция памяти между воркспейсами
 * Строгий запрет на протекание данных одного клиентского проекта в граф другого
 * Operation Code: workspace_isolation_fence
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F113_FEATURE_ID = "F113" as const;
export const F113_STAGE = "stage4-intelligence-graph" as const;
export const F113_OPERATION_CODE = "workspace_isolation_fence" as const;
export const F113_CONTRACT_VERSION = "2.0.0" as const;

export type F113CrossWorkspaceMemoryIsolationExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F113CrossWorkspaceMemoryIsolationConfig = BaseFeatureConfig<
  typeof F113_FEATURE_ID,
  typeof F113_STAGE,
  typeof F113_OPERATION_CODE
>;

export interface F113CrossWorkspaceMemoryIsolationInput extends BaseFeatureInput {
  readonly source_workspace_id: string;
  readonly target_workspace_id: string | number;
  readonly cross_leak_blocked: string | number | boolean | readonly string[];
  readonly isolation_verified: string | number | boolean | Record<string, unknown>;
}

export type F113CrossWorkspaceMemoryIsolationAuditEntry = BaseFeatureAuditEntry<
  typeof F113_FEATURE_ID
>;

export interface F113CrossWorkspaceMemoryIsolationOutput {
  readonly featureId: typeof F113_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F113CrossWorkspaceMemoryIsolationExecutionStatus;
  readonly operationCode: typeof F113_OPERATION_CODE;
  readonly resolved_source_workspace_id: string;
  readonly resolved_target_workspace_id: string | number;
  readonly resolved_cross_leak_blocked: string | number | boolean | readonly string[];
  readonly resolved_isolation_verified: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F113CrossWorkspaceMemoryIsolationAuditEntry;
}

export type F113CrossWorkspaceMemoryIsolationTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F113_FEATURE_ID
>;

export const DEFAULT_F113_CONFIG: F113CrossWorkspaceMemoryIsolationConfig = {
  featureId: F113_FEATURE_ID,
  stage: F113_STAGE,
  operationCode: F113_OPERATION_CODE,
  contractVersion: F113_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F113CrossWorkspaceMemoryIsolationValidationError extends Error {
  public readonly featureId = F113_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F113 Validation Error on '${field}']: ${message}`);
    this.name = "F113CrossWorkspaceMemoryIsolationValidationError";
    this.field = field;
  }
}

export function computeF113Digest(rawPayload: string): string {
  return `f113_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F113CrossWorkspaceMemoryIsolationEngine extends KosmoraFeatureAdapterBase<
  typeof F113_FEATURE_ID,
  typeof F113_STAGE,
  typeof F113_OPERATION_CODE,
  F113CrossWorkspaceMemoryIsolationConfig,
  F113CrossWorkspaceMemoryIsolationInput,
  F113CrossWorkspaceMemoryIsolationOutput
> {
  constructor(
    customConfig?: Partial<F113CrossWorkspaceMemoryIsolationConfig>,
    kernel?: Stage4GraphKernel
  ) {
    super(
      DEFAULT_F113_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      [
        "source_workspace_id",
        "target_workspace_id",
        "cross_leak_blocked",
        "isolation_verified"
      ] as const,
      F113CrossWorkspaceMemoryIsolationValidationError
    );
  }
}

export function verifyF113Module(): {
  featureId: typeof F113_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F113CrossWorkspaceMemoryIsolationEngine();
  const sampleInput: F113CrossWorkspaceMemoryIsolationInput = {
    requestId: "req_verify_f113",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    source_workspace_id: "f113_source_workspace_id_seed",
    target_workspace_id: 42,
    cross_leak_blocked: true,
    isolation_verified: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 113 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F113" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_workspace_id !== sampleInput.source_workspace_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F113_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
