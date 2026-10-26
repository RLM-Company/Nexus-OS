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

export const F493_FEATURE_ID = "F493" as const;
export const F493_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F493_OPERATION_CODE = "F493_AST_SUBTREE_CROSSOVER_RECOMBINATION_OPERATOR" as const;
export const F493_CONTRACT_VERSION = "2.0.0" as const;

export type F493AstSubtreeCrossoverRecombinationOperatorConfig = BaseFeatureConfig<
  typeof F493_FEATURE_ID,
  typeof F493_STAGE,
  typeof F493_OPERATION_CODE
>;

export interface F493AstSubtreeCrossoverRecombinationOperatorInput extends BaseFeatureInput {
  readonly parent_ast_alpha: string | number | boolean | readonly string[];
  readonly parent_ast_beta: string | number | boolean | readonly string[];
  readonly crossover_node_type: string | number | boolean | readonly string[];
  readonly offspring_ast_valid: string | number | boolean | readonly string[];
}

export interface F493AstSubtreeCrossoverRecombinationOperatorOutput {
  readonly featureId: typeof F493_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F493_OPERATION_CODE;
  readonly resolved_parent_ast_alpha: unknown;
  readonly resolved_parent_ast_beta: unknown;
  readonly resolved_crossover_node_type: unknown;
  readonly resolved_offspring_ast_valid: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F493_FEATURE_ID>;
}

export type F493AstSubtreeCrossoverRecombinationOperatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F493_FEATURE_ID
>;

export const DEFAULT_F493_CONFIG: F493AstSubtreeCrossoverRecombinationOperatorConfig = {
  featureId: F493_FEATURE_ID,
  stage: F493_STAGE,
  operationCode: F493_OPERATION_CODE,
  contractVersion: F493_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F493AstSubtreeCrossoverRecombinationOperatorValidationError extends Error {
  public readonly featureId = F493_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F493 Validation Error on '${field}']: ${message}`);
    this.name = "F493AstSubtreeCrossoverRecombinationOperatorValidationError";
    this.field = field;
  }
}

export function computeF493Digest(rawPayload: string): string {
  return `f493_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F493AstSubtreeCrossoverRecombinationOperatorService extends KosmoraFeatureAdapterBase<
  typeof F493_FEATURE_ID,
  typeof F493_STAGE,
  typeof F493_OPERATION_CODE,
  F493AstSubtreeCrossoverRecombinationOperatorConfig,
  F493AstSubtreeCrossoverRecombinationOperatorInput,
  F493AstSubtreeCrossoverRecombinationOperatorOutput
> {
  constructor(
    customConfig?: Partial<F493AstSubtreeCrossoverRecombinationOperatorConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F493_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "parent_ast_alpha",
        "parent_ast_beta",
        "crossover_node_type",
        "offspring_ast_valid"
      ] as const,
      F493AstSubtreeCrossoverRecombinationOperatorValidationError
    );
  }
}

export function verifyF493Module(): {
  readonly featureId: typeof F493_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F493AstSubtreeCrossoverRecombinationOperatorService();
  const sampleInput: F493AstSubtreeCrossoverRecombinationOperatorInput = {
    requestId: "req_verify_f493",
    projectId: "proj_kosmora_f493",
    workspaceId: "ws_kosmora_f493",
    tenantId: "tenant_rlm_f493",
    actorId: "actor_verifier_f493",
    autonomyLevel: "A3",
    parent_ast_alpha: "seed_f493_parent_ast_alpha",
    parent_ast_beta: 42,
    crossover_node_type: true,
    offspring_ast_valid: "seed_f493_offspring_ast_valid",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F493" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F493" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_parent_ast_alpha !== sampleInput.parent_ast_alpha &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F493] Verification failed`);
  }

  return {
    featureId: F493_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
