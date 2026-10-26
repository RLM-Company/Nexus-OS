/**
 * F165 (stage6-sovereign-cluster): CRDT LWW-Element-Set мутатор блоков Canvas
 * Конфликтно-свободное обновление и удаление блоков документа с гибридными логическими часами Лампорта
 * Operation Code: crdt_lww_canvas_block_mutator
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

export const F165_FEATURE_ID = "F165" as const;
export const F165_STAGE = "stage6-sovereign-cluster" as const;
export const F165_OPERATION_CODE = "crdt_lww_canvas_block_mutator" as const;
export const F165_CONTRACT_VERSION = "2.0.0" as const;

export type F165CrdtLwwCanvasBlockMutatorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F165CrdtLwwCanvasBlockMutatorConfig = BaseFeatureConfig<
  typeof F165_FEATURE_ID,
  typeof F165_STAGE,
  typeof F165_OPERATION_CODE
>;

export interface F165CrdtLwwCanvasBlockMutatorInput extends BaseFeatureInput {
  readonly document_id: string;
  readonly block_id: string | number;
  readonly lamport_clock: string | number | boolean | readonly string[];
  readonly replica_id: string | number | boolean | Record<string, unknown>;
}

export type F165CrdtLwwCanvasBlockMutatorAuditEntry = BaseFeatureAuditEntry<typeof F165_FEATURE_ID>;

export interface F165CrdtLwwCanvasBlockMutatorOutput {
  readonly featureId: typeof F165_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F165CrdtLwwCanvasBlockMutatorExecutionStatus;
  readonly operationCode: typeof F165_OPERATION_CODE;
  readonly resolved_document_id: string;
  readonly resolved_block_id: string | number;
  readonly resolved_lamport_clock: string | number | boolean | readonly string[];
  readonly resolved_replica_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F165CrdtLwwCanvasBlockMutatorAuditEntry;
}

export type F165CrdtLwwCanvasBlockMutatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F165_FEATURE_ID>;

export const DEFAULT_F165_CONFIG: F165CrdtLwwCanvasBlockMutatorConfig = {
  featureId: F165_FEATURE_ID,
  stage: F165_STAGE,
  operationCode: F165_OPERATION_CODE,
  contractVersion: F165_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F165CrdtLwwCanvasBlockMutatorValidationError extends Error {
  public readonly featureId = F165_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F165 Validation Error on '${field}']: ${message}`);
    this.name = "F165CrdtLwwCanvasBlockMutatorValidationError";
    this.field = field;
  }
}

export function computeF165Digest(rawPayload: string): string {
  return `f165_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F165CrdtLwwCanvasBlockMutatorEngine extends KosmoraFeatureAdapterBase<
  typeof F165_FEATURE_ID,
  typeof F165_STAGE,
  typeof F165_OPERATION_CODE,
  F165CrdtLwwCanvasBlockMutatorConfig,
  F165CrdtLwwCanvasBlockMutatorInput,
  F165CrdtLwwCanvasBlockMutatorOutput
> {
  constructor(customConfig?: Partial<F165CrdtLwwCanvasBlockMutatorConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F165_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["document_id", "block_id", "lamport_clock", "replica_id"] as const,
      F165CrdtLwwCanvasBlockMutatorValidationError
    );
  }
}

export function verifyF165Module(): {
  featureId: typeof F165_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F165CrdtLwwCanvasBlockMutatorEngine();
  const sampleInput: F165CrdtLwwCanvasBlockMutatorInput = {
    requestId: "req_verify_f165",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    document_id: "f165_document_id_seed",
    block_id: 42,
    lamport_clock: true,
    replica_id: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 165 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F165" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_document_id !== sampleInput.document_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F165_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
