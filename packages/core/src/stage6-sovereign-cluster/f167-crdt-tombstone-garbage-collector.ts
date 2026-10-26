/**
 * F167 (stage6-sovereign-cluster): Сборка мусора для удалённых CRDT-блоков (Tombstone GC)
 * Безопасная очистка метаданных удалённых блоков после достижения стабильного векторного горизонта
 * Operation Code: crdt_tombstone_garbage_collector
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

export const F167_FEATURE_ID = "F167" as const;
export const F167_STAGE = "stage6-sovereign-cluster" as const;
export const F167_OPERATION_CODE = "crdt_tombstone_garbage_collector" as const;
export const F167_CONTRACT_VERSION = "2.0.0" as const;

export type F167CrdtTombstoneGarbageCollectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F167CrdtTombstoneGarbageCollectorConfig = BaseFeatureConfig<
  typeof F167_FEATURE_ID,
  typeof F167_STAGE,
  typeof F167_OPERATION_CODE
>;

export interface F167CrdtTombstoneGarbageCollectorInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly tombstones_inspected: string | number;
  readonly retained_active_blocks: string | number | boolean | readonly string[];
  readonly state_digest: string | number | boolean | Record<string, unknown>;
}

export type F167CrdtTombstoneGarbageCollectorAuditEntry = BaseFeatureAuditEntry<typeof F167_FEATURE_ID>;

export interface F167CrdtTombstoneGarbageCollectorOutput {
  readonly featureId: typeof F167_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F167CrdtTombstoneGarbageCollectorExecutionStatus;
  readonly operationCode: typeof F167_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_tombstones_inspected: string | number;
  readonly resolved_retained_active_blocks: string | number | boolean | readonly string[];
  readonly resolved_state_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F167CrdtTombstoneGarbageCollectorAuditEntry;
}

export type F167CrdtTombstoneGarbageCollectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F167_FEATURE_ID>;

export const DEFAULT_F167_CONFIG: F167CrdtTombstoneGarbageCollectorConfig = {
  featureId: F167_FEATURE_ID,
  stage: F167_STAGE,
  operationCode: F167_OPERATION_CODE,
  contractVersion: F167_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F167CrdtTombstoneGarbageCollectorValidationError extends Error {
  public readonly featureId = F167_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F167 Validation Error on '${field}']: ${message}`);
    this.name = "F167CrdtTombstoneGarbageCollectorValidationError";
    this.field = field;
  }
}

export function computeF167Digest(rawPayload: string): string {
  return `f167_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F167CrdtTombstoneGarbageCollectorEngine extends KosmoraFeatureAdapterBase<
  typeof F167_FEATURE_ID,
  typeof F167_STAGE,
  typeof F167_OPERATION_CODE,
  F167CrdtTombstoneGarbageCollectorConfig,
  F167CrdtTombstoneGarbageCollectorInput,
  F167CrdtTombstoneGarbageCollectorOutput
> {
  constructor(customConfig?: Partial<F167CrdtTombstoneGarbageCollectorConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F167_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["document_id", "tombstones_inspected", "retained_active_blocks", "state_digest"] as const,
      F167CrdtTombstoneGarbageCollectorValidationError
    );
  }
}

export function verifyF167Module(): {
  featureId: typeof F167_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F167CrdtTombstoneGarbageCollectorEngine();
  const sampleInput: F167CrdtTombstoneGarbageCollectorInput = {
    requestId: "req_verify_f167",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f167_document_id_seed",
    tombstones_inspected: 42,
    retained_active_blocks: true,
    state_digest: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 167 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F167" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F167_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
