/**
 * F005 (stage1-autonomy): Валидатор графа происхождения в рантайме
 * Автоматическая проверка целостности ссылок provenance перед закрытием задачи менеджером
 * Operation Code: provenance_validator
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

export const F005_FEATURE_ID = "F005" as const;
export const F005_STAGE = "stage1-autonomy" as const;
export const F005_OPERATION_CODE = "provenance_validator" as const;
export const F005_CONTRACT_VERSION = "2.0.0" as const;

export type F005RuntimeProvenanceValidatorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F005RuntimeProvenanceValidatorConfig = BaseFeatureConfig<
  typeof F005_FEATURE_ID,
  typeof F005_STAGE,
  typeof F005_OPERATION_CODE
>;

export interface F005RuntimeProvenanceValidatorInput extends BaseFeatureInput {
  readonly graph_id: string;
  readonly checked_nodes: string | number;
  readonly integrity_passed: string | number | boolean | readonly string[];
  readonly missing_links: string | number | boolean | Record<string, unknown>;
}

export type F005RuntimeProvenanceValidatorAuditEntry = BaseFeatureAuditEntry<
  typeof F005_FEATURE_ID
>;

export interface F005RuntimeProvenanceValidatorOutput {
  readonly featureId: typeof F005_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F005RuntimeProvenanceValidatorExecutionStatus;
  readonly operationCode: typeof F005_OPERATION_CODE;
  readonly resolved_graph_id: string;
  readonly resolved_checked_nodes: string | number;
  readonly resolved_integrity_passed: string | number | boolean | readonly string[];
  readonly resolved_missing_links: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F005RuntimeProvenanceValidatorAuditEntry;
}

export type F005RuntimeProvenanceValidatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F005_FEATURE_ID
>;

export const DEFAULT_F005_CONFIG: F005RuntimeProvenanceValidatorConfig = {
  featureId: F005_FEATURE_ID,
  stage: F005_STAGE,
  operationCode: F005_OPERATION_CODE,
  contractVersion: F005_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F005RuntimeProvenanceValidatorValidationError extends Error {
  public readonly featureId = F005_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F005 Validation Error on '${field}']: ${message}`);
    this.name = "F005RuntimeProvenanceValidatorValidationError";
    this.field = field;
  }
}

export function computeF005Digest(rawPayload: string): string {
  return `f005_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F005RuntimeProvenanceValidatorEngine extends KosmoraFeatureAdapterBase<
  typeof F005_FEATURE_ID,
  typeof F005_STAGE,
  typeof F005_OPERATION_CODE,
  F005RuntimeProvenanceValidatorConfig,
  F005RuntimeProvenanceValidatorInput,
  F005RuntimeProvenanceValidatorOutput
> {
  constructor(
    customConfig?: Partial<F005RuntimeProvenanceValidatorConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F005_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["graph_id", "checked_nodes", "integrity_passed", "missing_links"] as const,
      F005RuntimeProvenanceValidatorValidationError
    );
  }
}

export function verifyF005Module(): {
  featureId: typeof F005_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F005RuntimeProvenanceValidatorEngine();
  const sampleInput: F005RuntimeProvenanceValidatorInput = {
    requestId: "req_verify_f005",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    graph_id: "f005_graph_id_seed",
    checked_nodes: 42,
    integrity_passed: true,
    missing_links: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 5 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F005" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_graph_id !== sampleInput.graph_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F005_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
