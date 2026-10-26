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

export const F495_FEATURE_ID = "F495" as const;
export const F495_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F495_OPERATION_CODE = "F495_LEXICASE_SELECTION_UNAGGREGATED_TEST_FILTER" as const;
export const F495_CONTRACT_VERSION = "2.0.0" as const;

export type F495LexicaseSelectionUnaggregatedTestFilterConfig = BaseFeatureConfig<
  typeof F495_FEATURE_ID,
  typeof F495_STAGE,
  typeof F495_OPERATION_CODE
>;

export interface F495LexicaseSelectionUnaggregatedTestFilterInput extends BaseFeatureInput {
  readonly candidate_pool: string | number | boolean | readonly string[];
  readonly shuffled_test_cases: string | number | boolean | readonly string[];
  readonly elite_survivors: string | number | boolean | readonly string[];
  readonly specialist_preserved: string | number | boolean | readonly string[];
}

export interface F495LexicaseSelectionUnaggregatedTestFilterOutput {
  readonly featureId: typeof F495_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F495_OPERATION_CODE;
  readonly resolved_candidate_pool: unknown;
  readonly resolved_shuffled_test_cases: unknown;
  readonly resolved_elite_survivors: unknown;
  readonly resolved_specialist_preserved: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F495_FEATURE_ID>;
}

export type F495LexicaseSelectionUnaggregatedTestFilterTelemetrySnapshot = BaseFeatureTelemetry<typeof F495_FEATURE_ID>;

export const DEFAULT_F495_CONFIG: F495LexicaseSelectionUnaggregatedTestFilterConfig = {
  featureId: F495_FEATURE_ID,
  stage: F495_STAGE,
  operationCode: F495_OPERATION_CODE,
  contractVersion: F495_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F495LexicaseSelectionUnaggregatedTestFilterValidationError extends Error {
  public readonly featureId = F495_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F495 Validation Error on '${field}']: ${message}`);
    this.name = "F495LexicaseSelectionUnaggregatedTestFilterValidationError";
    this.field = field;
  }
}

export function computeF495Digest(rawPayload: string): string {
  return `f495_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F495LexicaseSelectionUnaggregatedTestFilterService extends KosmoraFeatureAdapterBase<
  typeof F495_FEATURE_ID,
  typeof F495_STAGE,
  typeof F495_OPERATION_CODE,
  F495LexicaseSelectionUnaggregatedTestFilterConfig,
  F495LexicaseSelectionUnaggregatedTestFilterInput,
  F495LexicaseSelectionUnaggregatedTestFilterOutput
> {
  constructor(customConfig?: Partial<F495LexicaseSelectionUnaggregatedTestFilterConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F495_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["candidate_pool", "shuffled_test_cases", "elite_survivors", "specialist_preserved"] as const,
      F495LexicaseSelectionUnaggregatedTestFilterValidationError
    );
  }
}

export function verifyF495Module(): {
  readonly featureId: typeof F495_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F495LexicaseSelectionUnaggregatedTestFilterService();
  const sampleInput: F495LexicaseSelectionUnaggregatedTestFilterInput = {
    requestId: "req_verify_f495",
    projectId: "proj_kosmora_f495",
    workspaceId: "ws_kosmora_f495",
    tenantId: "tenant_rlm_f495",
    actorId: "actor_verifier_f495",
    autonomyLevel: "A3",
    candidate_pool: "seed_f495_candidate_pool",
    shuffled_test_cases: 42,
    elite_survivors: true,
    specialist_preserved: "seed_f495_specialist_preserved",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F495" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F495" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_pool !== sampleInput.candidate_pool &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F495] Verification failed`);
  }

  return {
    featureId: F495_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
