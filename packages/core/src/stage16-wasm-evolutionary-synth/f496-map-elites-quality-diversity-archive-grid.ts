import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage16WasmEvolutionarySynthKernel } from "./stage-kernel.js";

export const F496_FEATURE_ID = "F496" as const;
export const F496_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F496_OPERATION_CODE = "F496_MAP_ELITES_QUALITY_DIVERSITY_ARCHIVE_GRID" as const;
export const F496_CONTRACT_VERSION = "2.0.0" as const;

export type F496MapElitesQualityDiversityArchiveGridConfig = BaseFeatureConfig<
  typeof F496_FEATURE_ID,
  typeof F496_STAGE,
  typeof F496_OPERATION_CODE
>;

export interface F496MapElitesQualityDiversityArchiveGridInput extends BaseFeatureInput {
  readonly behavior_descriptors: string | number | boolean | readonly string[];
  readonly fitness_scores: string | number | boolean | readonly string[];
  readonly grid_cells_populated: string | number | boolean | readonly string[];
  readonly qd_archive_score: string | number | boolean | readonly string[];
}

export interface F496MapElitesQualityDiversityArchiveGridOutput {
  readonly featureId: typeof F496_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F496_OPERATION_CODE;
  readonly resolved_behavior_descriptors: unknown;
  readonly resolved_fitness_scores: unknown;
  readonly resolved_grid_cells_populated: unknown;
  readonly resolved_qd_archive_score: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F496_FEATURE_ID>;
}

export type F496MapElitesQualityDiversityArchiveGridTelemetrySnapshot = BaseFeatureTelemetry<typeof F496_FEATURE_ID>;

export const DEFAULT_F496_CONFIG: F496MapElitesQualityDiversityArchiveGridConfig = {
  featureId: F496_FEATURE_ID,
  stage: F496_STAGE,
  operationCode: F496_OPERATION_CODE,
  contractVersion: F496_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F496MapElitesQualityDiversityArchiveGridValidationError extends Error {
  public readonly featureId = F496_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F496 Validation Error on '${field}']: ${message}`);
    this.name = "F496MapElitesQualityDiversityArchiveGridValidationError";
    this.field = field;
  }
}

export function computeF496Digest(rawPayload: string): string {
  return `f496_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F496MapElitesQualityDiversityArchiveGridService extends KosmoraFeatureAdapterBase<
  typeof F496_FEATURE_ID,
  typeof F496_STAGE,
  typeof F496_OPERATION_CODE,
  F496MapElitesQualityDiversityArchiveGridConfig,
  F496MapElitesQualityDiversityArchiveGridInput,
  F496MapElitesQualityDiversityArchiveGridOutput
> {
  constructor(customConfig?: Partial<F496MapElitesQualityDiversityArchiveGridConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F496_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["behavior_descriptors", "fitness_scores", "grid_cells_populated", "qd_archive_score"] as const,
      F496MapElitesQualityDiversityArchiveGridValidationError
    );
  }
}

export function verifyF496Module(): {
  readonly featureId: typeof F496_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F496MapElitesQualityDiversityArchiveGridService();
  const sampleInput: F496MapElitesQualityDiversityArchiveGridInput = {
    requestId: "req_verify_f496",
    projectId: "proj_kosmora_f496",
    workspaceId: "ws_kosmora_f496",
    tenantId: "tenant_rlm_f496",
    actorId: "actor_verifier_f496",
    autonomyLevel: "A3",
    behavior_descriptors: "seed_f496_behavior_descriptors",
    fitness_scores: 42,
    grid_cells_populated: true,
    qd_archive_score: "seed_f496_qd_archive_score",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F496" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F496" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_behavior_descriptors !== sampleInput.behavior_descriptors &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F496] Verification failed`);
  }

  return {
    featureId: F496_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
