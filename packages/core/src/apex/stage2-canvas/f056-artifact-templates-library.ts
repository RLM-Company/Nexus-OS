/**
 * F056 (stage2-canvas): Библиотека шаблонов артефактов
 * Готовые каркасы для питч-деков, ТЗ, финансовых моделей и дизайн-доков
 * Operation Code: template_catalog
 */

import { createHash } from "node:crypto";
import {
  Stage2CanvasKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F056_FEATURE_ID = "F056" as const;
export const F056_STAGE = "stage2-canvas" as const;
export const F056_OPERATION_CODE = "template_catalog" as const;
export const F056_CONTRACT_VERSION = "2.0.0" as const;

export type F056ArtifactTemplatesLibraryExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F056ArtifactTemplatesLibraryConfig = BaseFeatureConfig<
  typeof F056_FEATURE_ID,
  typeof F056_STAGE,
  typeof F056_OPERATION_CODE
>;

export interface F056ArtifactTemplatesLibraryInput extends BaseFeatureInput {
  readonly template_id: string;
  readonly category: string | number;
  readonly sections_scaffold: string | number | boolean | readonly string[];
  readonly default_variables: string | number | boolean | Record<string, unknown>;
}

export type F056ArtifactTemplatesLibraryAuditEntry = BaseFeatureAuditEntry<typeof F056_FEATURE_ID>;

export interface F056ArtifactTemplatesLibraryOutput {
  readonly featureId: typeof F056_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F056ArtifactTemplatesLibraryExecutionStatus;
  readonly operationCode: typeof F056_OPERATION_CODE;
  readonly resolved_template_id: string;
  readonly resolved_category: string | number;
  readonly resolved_sections_scaffold: string | number | boolean | readonly string[];
  readonly resolved_default_variables: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F056ArtifactTemplatesLibraryAuditEntry;
}

export type F056ArtifactTemplatesLibraryTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F056_FEATURE_ID
>;

export const DEFAULT_F056_CONFIG: F056ArtifactTemplatesLibraryConfig = {
  featureId: F056_FEATURE_ID,
  stage: F056_STAGE,
  operationCode: F056_OPERATION_CODE,
  contractVersion: F056_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F056ArtifactTemplatesLibraryValidationError extends Error {
  public readonly featureId = F056_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F056 Validation Error on '${field}']: ${message}`);
    this.name = "F056ArtifactTemplatesLibraryValidationError";
    this.field = field;
  }
}

export function computeF056Digest(rawPayload: string): string {
  return `f056_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F056ArtifactTemplatesLibraryEngine extends KosmoraFeatureAdapterBase<
  typeof F056_FEATURE_ID,
  typeof F056_STAGE,
  typeof F056_OPERATION_CODE,
  F056ArtifactTemplatesLibraryConfig,
  F056ArtifactTemplatesLibraryInput,
  F056ArtifactTemplatesLibraryOutput
> {
  constructor(
    customConfig?: Partial<F056ArtifactTemplatesLibraryConfig>,
    kernel?: Stage2CanvasKernel
  ) {
    super(
      DEFAULT_F056_CONFIG,
      customConfig,
      kernel ?? new Stage2CanvasKernel(),
      ["template_id", "category", "sections_scaffold", "default_variables"] as const,
      F056ArtifactTemplatesLibraryValidationError
    );
  }
}

export function verifyF056Module(): {
  featureId: typeof F056_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F056ArtifactTemplatesLibraryEngine();
  const sampleInput: F056ArtifactTemplatesLibraryInput = {
    requestId: "req_verify_f056",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    template_id: "f056_template_id_seed",
    category: 42,
    sections_scaffold: true,
    default_variables: "verified_seed",
    metadata: { stage: "stage2-canvas", featureNumber: 56 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F056" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_template_id !== sampleInput.template_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F056_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
