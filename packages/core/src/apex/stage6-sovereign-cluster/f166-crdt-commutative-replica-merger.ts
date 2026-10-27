/**
 * F166 (stage6-sovereign-cluster): Коммутативное слияние состояний CRDT-реплик
 * Детерминированное объединение конкурентных правок из нескольких офлайн/онлайн реплик без потери данных
 * Operation Code: crdt_commutative_replica_merger
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

export const F166_FEATURE_ID = "F166" as const;
export const F166_STAGE = "stage6-sovereign-cluster" as const;
export const F166_OPERATION_CODE = "crdt_commutative_replica_merger" as const;
export const F166_CONTRACT_VERSION = "2.0.0" as const;

export type F166CrdtCommutativeReplicaMergerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F166CrdtCommutativeReplicaMergerConfig = BaseFeatureConfig<
  typeof F166_FEATURE_ID,
  typeof F166_STAGE,
  typeof F166_OPERATION_CODE
>;

export interface F166CrdtCommutativeReplicaMergerInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly merged_op_count: string | number;
  readonly active_blocks_count: string | number | boolean | readonly string[];
  readonly convergence_digest: string | number | boolean | Record<string, unknown>;
}

export type F166CrdtCommutativeReplicaMergerAuditEntry = BaseFeatureAuditEntry<
  typeof F166_FEATURE_ID
>;

export interface F166CrdtCommutativeReplicaMergerOutput {
  readonly featureId: typeof F166_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F166CrdtCommutativeReplicaMergerExecutionStatus;
  readonly operationCode: typeof F166_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_merged_op_count: string | number;
  readonly resolved_active_blocks_count: string | number | boolean | readonly string[];
  readonly resolved_convergence_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F166CrdtCommutativeReplicaMergerAuditEntry;
}

export type F166CrdtCommutativeReplicaMergerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F166_FEATURE_ID
>;

export const DEFAULT_F166_CONFIG: F166CrdtCommutativeReplicaMergerConfig = {
  featureId: F166_FEATURE_ID,
  stage: F166_STAGE,
  operationCode: F166_OPERATION_CODE,
  contractVersion: F166_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F166CrdtCommutativeReplicaMergerValidationError extends Error {
  public readonly featureId = F166_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F166 Validation Error on '${field}']: ${message}`);
    this.name = "F166CrdtCommutativeReplicaMergerValidationError";
    this.field = field;
  }
}

export function computeF166Digest(rawPayload: string): string {
  return `f166_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F166CrdtCommutativeReplicaMergerEngine extends KosmoraFeatureAdapterBase<
  typeof F166_FEATURE_ID,
  typeof F166_STAGE,
  typeof F166_OPERATION_CODE,
  F166CrdtCommutativeReplicaMergerConfig,
  F166CrdtCommutativeReplicaMergerInput,
  F166CrdtCommutativeReplicaMergerOutput
> {
  constructor(
    customConfig?: Partial<F166CrdtCommutativeReplicaMergerConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F166_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["document_id", "merged_op_count", "active_blocks_count", "convergence_digest"] as const,
      F166CrdtCommutativeReplicaMergerValidationError
    );
  }
}

export function verifyF166Module(): {
  featureId: typeof F166_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F166CrdtCommutativeReplicaMergerEngine();
  const sampleInput: F166CrdtCommutativeReplicaMergerInput = {
    requestId: "req_verify_f166",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f166_document_id_seed",
    merged_op_count: 42,
    active_blocks_count: true,
    convergence_digest: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 166 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F166" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F166_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
