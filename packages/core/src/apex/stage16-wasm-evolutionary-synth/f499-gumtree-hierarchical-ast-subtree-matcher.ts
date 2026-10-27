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

export const F499_FEATURE_ID = "F499" as const;
export const F499_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F499_OPERATION_CODE = "F499_GUMTREE_HIERARCHICAL_AST_SUBTREE_MATCHER" as const;
export const F499_CONTRACT_VERSION = "2.0.0" as const;

export type F499GumtreeHierarchicalAstSubtreeMatcherConfig = BaseFeatureConfig<
  typeof F499_FEATURE_ID,
  typeof F499_STAGE,
  typeof F499_OPERATION_CODE
>;

export interface F499GumtreeHierarchicalAstSubtreeMatcherInput extends BaseFeatureInput {
  readonly source_tree_hashes: string | number | boolean | readonly string[];
  readonly target_tree_hashes: string | number | boolean | readonly string[];
  readonly isomorphic_anchors: string | number | boolean | readonly string[];
  readonly move_actions_detected: string | number | boolean | readonly string[];
}

export interface F499GumtreeHierarchicalAstSubtreeMatcherOutput {
  readonly featureId: typeof F499_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F499_OPERATION_CODE;
  readonly resolved_source_tree_hashes: unknown;
  readonly resolved_target_tree_hashes: unknown;
  readonly resolved_isomorphic_anchors: unknown;
  readonly resolved_move_actions_detected: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F499_FEATURE_ID>;
}

export type F499GumtreeHierarchicalAstSubtreeMatcherTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F499_FEATURE_ID
>;

export const DEFAULT_F499_CONFIG: F499GumtreeHierarchicalAstSubtreeMatcherConfig = {
  featureId: F499_FEATURE_ID,
  stage: F499_STAGE,
  operationCode: F499_OPERATION_CODE,
  contractVersion: F499_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F499GumtreeHierarchicalAstSubtreeMatcherValidationError extends Error {
  public readonly featureId = F499_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F499 Validation Error on '${field}']: ${message}`);
    this.name = "F499GumtreeHierarchicalAstSubtreeMatcherValidationError";
    this.field = field;
  }
}

export function computeF499Digest(rawPayload: string): string {
  return `f499_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F499GumtreeHierarchicalAstSubtreeMatcherService extends KosmoraFeatureAdapterBase<
  typeof F499_FEATURE_ID,
  typeof F499_STAGE,
  typeof F499_OPERATION_CODE,
  F499GumtreeHierarchicalAstSubtreeMatcherConfig,
  F499GumtreeHierarchicalAstSubtreeMatcherInput,
  F499GumtreeHierarchicalAstSubtreeMatcherOutput
> {
  constructor(
    customConfig?: Partial<F499GumtreeHierarchicalAstSubtreeMatcherConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F499_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "source_tree_hashes",
        "target_tree_hashes",
        "isomorphic_anchors",
        "move_actions_detected"
      ] as const,
      F499GumtreeHierarchicalAstSubtreeMatcherValidationError
    );
  }
}

export function verifyF499Module(): {
  readonly featureId: typeof F499_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F499GumtreeHierarchicalAstSubtreeMatcherService();
  const sampleInput: F499GumtreeHierarchicalAstSubtreeMatcherInput = {
    requestId: "req_verify_f499",
    projectId: "proj_kosmora_f499",
    workspaceId: "ws_kosmora_f499",
    tenantId: "tenant_rlm_f499",
    actorId: "actor_verifier_f499",
    autonomyLevel: "A3",
    source_tree_hashes: "seed_f499_source_tree_hashes",
    target_tree_hashes: 42,
    isomorphic_anchors: true,
    move_actions_detected: "seed_f499_move_actions_detected",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F499" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F499" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_tree_hashes !== sampleInput.source_tree_hashes &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F499] Verification failed`);
  }

  return {
    featureId: F499_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
