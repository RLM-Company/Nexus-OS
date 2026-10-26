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

export const F492_FEATURE_ID = "F492" as const;
export const F492_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F492_OPERATION_CODE = "F492_TOURNAMENT_CROWDED_COMPARISON_GENETIC_SELECTOR" as const;
export const F492_CONTRACT_VERSION = "2.0.0" as const;

export type F492TournamentCrowdedComparisonGeneticSelectorConfig = BaseFeatureConfig<
  typeof F492_FEATURE_ID,
  typeof F492_STAGE,
  typeof F492_OPERATION_CODE
>;

export interface F492TournamentCrowdedComparisonGeneticSelectorInput extends BaseFeatureInput {
  readonly ranked_candidates: string | number | boolean | readonly string[];
  readonly tournament_size_k: string | number | boolean | readonly string[];
  readonly selection_seed: string | number | boolean | readonly string[];
  readonly selected_parents: string | number | boolean | readonly string[];
}

export interface F492TournamentCrowdedComparisonGeneticSelectorOutput {
  readonly featureId: typeof F492_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F492_OPERATION_CODE;
  readonly resolved_ranked_candidates: unknown;
  readonly resolved_tournament_size_k: unknown;
  readonly resolved_selection_seed: unknown;
  readonly resolved_selected_parents: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F492_FEATURE_ID>;
}

export type F492TournamentCrowdedComparisonGeneticSelectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F492_FEATURE_ID>;

export const DEFAULT_F492_CONFIG: F492TournamentCrowdedComparisonGeneticSelectorConfig = {
  featureId: F492_FEATURE_ID,
  stage: F492_STAGE,
  operationCode: F492_OPERATION_CODE,
  contractVersion: F492_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F492TournamentCrowdedComparisonGeneticSelectorValidationError extends Error {
  public readonly featureId = F492_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F492 Validation Error on '${field}']: ${message}`);
    this.name = "F492TournamentCrowdedComparisonGeneticSelectorValidationError";
    this.field = field;
  }
}

export function computeF492Digest(rawPayload: string): string {
  return `f492_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F492TournamentCrowdedComparisonGeneticSelectorService extends KosmoraFeatureAdapterBase<
  typeof F492_FEATURE_ID,
  typeof F492_STAGE,
  typeof F492_OPERATION_CODE,
  F492TournamentCrowdedComparisonGeneticSelectorConfig,
  F492TournamentCrowdedComparisonGeneticSelectorInput,
  F492TournamentCrowdedComparisonGeneticSelectorOutput
> {
  constructor(customConfig?: Partial<F492TournamentCrowdedComparisonGeneticSelectorConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F492_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["ranked_candidates", "tournament_size_k", "selection_seed", "selected_parents"] as const,
      F492TournamentCrowdedComparisonGeneticSelectorValidationError
    );
  }
}

export function verifyF492Module(): {
  readonly featureId: typeof F492_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F492TournamentCrowdedComparisonGeneticSelectorService();
  const sampleInput: F492TournamentCrowdedComparisonGeneticSelectorInput = {
    requestId: "req_verify_f492",
    projectId: "proj_kosmora_f492",
    workspaceId: "ws_kosmora_f492",
    tenantId: "tenant_rlm_f492",
    actorId: "actor_verifier_f492",
    autonomyLevel: "A3",
    ranked_candidates: "seed_f492_ranked_candidates",
    tournament_size_k: 42,
    selection_seed: true,
    selected_parents: "seed_f492_selected_parents",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F492" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F492" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_ranked_candidates !== sampleInput.ranked_candidates &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F492] Verification failed`);
  }

  return {
    featureId: F492_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
