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

export const F497_FEATURE_ID = "F497" as const;
export const F497_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F497_OPERATION_CODE = "F497_WAGNER_FISCHER_AST_EDIT_DISTANCE_CALCULATOR" as const;
export const F497_CONTRACT_VERSION = "2.0.0" as const;

export type F497WagnerFischerAstEditDistanceCalculatorConfig = BaseFeatureConfig<
  typeof F497_FEATURE_ID,
  typeof F497_STAGE,
  typeof F497_OPERATION_CODE
>;

export interface F497WagnerFischerAstEditDistanceCalculatorInput extends BaseFeatureInput {
  readonly source_ast_tokens: string | number | boolean | readonly string[];
  readonly target_ast_tokens: string | number | boolean | readonly string[];
  readonly edit_cost_matrix: string | number | boolean | readonly string[];
  readonly minimal_edit_distance: string | number | boolean | readonly string[];
}

export interface F497WagnerFischerAstEditDistanceCalculatorOutput {
  readonly featureId: typeof F497_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F497_OPERATION_CODE;
  readonly resolved_source_ast_tokens: unknown;
  readonly resolved_target_ast_tokens: unknown;
  readonly resolved_edit_cost_matrix: unknown;
  readonly resolved_minimal_edit_distance: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F497_FEATURE_ID>;
}

export type F497WagnerFischerAstEditDistanceCalculatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F497_FEATURE_ID>;

export const DEFAULT_F497_CONFIG: F497WagnerFischerAstEditDistanceCalculatorConfig = {
  featureId: F497_FEATURE_ID,
  stage: F497_STAGE,
  operationCode: F497_OPERATION_CODE,
  contractVersion: F497_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F497WagnerFischerAstEditDistanceCalculatorValidationError extends Error {
  public readonly featureId = F497_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F497 Validation Error on '${field}']: ${message}`);
    this.name = "F497WagnerFischerAstEditDistanceCalculatorValidationError";
    this.field = field;
  }
}

export function computeF497Digest(rawPayload: string): string {
  return `f497_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F497WagnerFischerAstEditDistanceCalculatorService extends KosmoraFeatureAdapterBase<
  typeof F497_FEATURE_ID,
  typeof F497_STAGE,
  typeof F497_OPERATION_CODE,
  F497WagnerFischerAstEditDistanceCalculatorConfig,
  F497WagnerFischerAstEditDistanceCalculatorInput,
  F497WagnerFischerAstEditDistanceCalculatorOutput
> {
  constructor(customConfig?: Partial<F497WagnerFischerAstEditDistanceCalculatorConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F497_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["source_ast_tokens", "target_ast_tokens", "edit_cost_matrix", "minimal_edit_distance"] as const,
      F497WagnerFischerAstEditDistanceCalculatorValidationError
    );
  }
}

export function verifyF497Module(): {
  readonly featureId: typeof F497_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F497WagnerFischerAstEditDistanceCalculatorService();
  const sampleInput: F497WagnerFischerAstEditDistanceCalculatorInput = {
    requestId: "req_verify_f497",
    projectId: "proj_kosmora_f497",
    workspaceId: "ws_kosmora_f497",
    tenantId: "tenant_rlm_f497",
    actorId: "actor_verifier_f497",
    autonomyLevel: "A3",
    source_ast_tokens: "seed_f497_source_ast_tokens",
    target_ast_tokens: 42,
    edit_cost_matrix: true,
    minimal_edit_distance: "seed_f497_minimal_edit_distance",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F497" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F497" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_ast_tokens !== sampleInput.source_ast_tokens &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F497] Verification failed`);
  }

  return {
    featureId: F497_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
