/**
 * F168 (stage6-sovereign-cluster): Синхронизатор причинно-следственных векторных часов
 * Вычисление дельты операций между репликами для досылки только недостающих правок
 * Operation Code: causal_vector_clock_synchronizer
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

export const F168_FEATURE_ID = "F168" as const;
export const F168_STAGE = "stage6-sovereign-cluster" as const;
export const F168_OPERATION_CODE = "causal_vector_clock_synchronizer" as const;
export const F168_CONTRACT_VERSION = "2.0.0" as const;

export type F168CausalVectorClockSynchronizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F168CausalVectorClockSynchronizerConfig = BaseFeatureConfig<
  typeof F168_FEATURE_ID,
  typeof F168_STAGE,
  typeof F168_OPERATION_CODE
>;

export interface F168CausalVectorClockSynchronizerInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly max_lamport_clock: string | number;
  readonly replica_count: string | number | boolean | readonly string[];
  readonly sync_status: string | number | boolean | Record<string, unknown>;
}

export type F168CausalVectorClockSynchronizerAuditEntry = BaseFeatureAuditEntry<typeof F168_FEATURE_ID>;

export interface F168CausalVectorClockSynchronizerOutput {
  readonly featureId: typeof F168_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F168CausalVectorClockSynchronizerExecutionStatus;
  readonly operationCode: typeof F168_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_max_lamport_clock: string | number;
  readonly resolved_replica_count: string | number | boolean | readonly string[];
  readonly resolved_sync_status: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F168CausalVectorClockSynchronizerAuditEntry;
}

export type F168CausalVectorClockSynchronizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F168_FEATURE_ID>;

export const DEFAULT_F168_CONFIG: F168CausalVectorClockSynchronizerConfig = {
  featureId: F168_FEATURE_ID,
  stage: F168_STAGE,
  operationCode: F168_OPERATION_CODE,
  contractVersion: F168_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F168CausalVectorClockSynchronizerValidationError extends Error {
  public readonly featureId = F168_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F168 Validation Error on '${field}']: ${message}`);
    this.name = "F168CausalVectorClockSynchronizerValidationError";
    this.field = field;
  }
}

export function computeF168Digest(rawPayload: string): string {
  return `f168_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F168CausalVectorClockSynchronizerEngine extends KosmoraFeatureAdapterBase<
  typeof F168_FEATURE_ID,
  typeof F168_STAGE,
  typeof F168_OPERATION_CODE,
  F168CausalVectorClockSynchronizerConfig,
  F168CausalVectorClockSynchronizerInput,
  F168CausalVectorClockSynchronizerOutput
> {
  constructor(customConfig?: Partial<F168CausalVectorClockSynchronizerConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F168_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["document_id", "max_lamport_clock", "replica_count", "sync_status"] as const,
      F168CausalVectorClockSynchronizerValidationError
    );
  }
}

export function verifyF168Module(): {
  featureId: typeof F168_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F168CausalVectorClockSynchronizerEngine();
  const sampleInput: F168CausalVectorClockSynchronizerInput = {
    requestId: "req_verify_f168",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f168_document_id_seed",
    max_lamport_clock: 42,
    replica_count: true,
    sync_status: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 168 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F168" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F168_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
