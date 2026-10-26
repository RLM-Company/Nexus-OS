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

export const F483_FEATURE_ID = "F483" as const;
export const F483_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F483_OPERATION_CODE = "F483_CONTROL_FLOW_GRAPH_DOMINATOR_TREE_BUILDER" as const;
export const F483_CONTRACT_VERSION = "2.0.0" as const;

export type F483ControlFlowGraphDominatorTreeBuilderConfig = BaseFeatureConfig<
  typeof F483_FEATURE_ID,
  typeof F483_STAGE,
  typeof F483_OPERATION_CODE
>;

export interface F483ControlFlowGraphDominatorTreeBuilderInput extends BaseFeatureInput {
  readonly basic_blocks: string | number | boolean | readonly string[];
  readonly cfg_directed_edges: string | number | boolean | readonly string[];
  readonly entry_block_id: string | number | boolean | readonly string[];
  readonly immediate_dominators: string | number | boolean | readonly string[];
}

export interface F483ControlFlowGraphDominatorTreeBuilderOutput {
  readonly featureId: typeof F483_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F483_OPERATION_CODE;
  readonly resolved_basic_blocks: unknown;
  readonly resolved_cfg_directed_edges: unknown;
  readonly resolved_entry_block_id: unknown;
  readonly resolved_immediate_dominators: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F483_FEATURE_ID>;
}

export type F483ControlFlowGraphDominatorTreeBuilderTelemetrySnapshot = BaseFeatureTelemetry<typeof F483_FEATURE_ID>;

export const DEFAULT_F483_CONFIG: F483ControlFlowGraphDominatorTreeBuilderConfig = {
  featureId: F483_FEATURE_ID,
  stage: F483_STAGE,
  operationCode: F483_OPERATION_CODE,
  contractVersion: F483_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F483ControlFlowGraphDominatorTreeBuilderValidationError extends Error {
  public readonly featureId = F483_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F483 Validation Error on '${field}']: ${message}`);
    this.name = "F483ControlFlowGraphDominatorTreeBuilderValidationError";
    this.field = field;
  }
}

export function computeF483Digest(rawPayload: string): string {
  return `f483_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F483ControlFlowGraphDominatorTreeBuilderService extends KosmoraFeatureAdapterBase<
  typeof F483_FEATURE_ID,
  typeof F483_STAGE,
  typeof F483_OPERATION_CODE,
  F483ControlFlowGraphDominatorTreeBuilderConfig,
  F483ControlFlowGraphDominatorTreeBuilderInput,
  F483ControlFlowGraphDominatorTreeBuilderOutput
> {
  constructor(customConfig?: Partial<F483ControlFlowGraphDominatorTreeBuilderConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F483_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["basic_blocks", "cfg_directed_edges", "entry_block_id", "immediate_dominators"] as const,
      F483ControlFlowGraphDominatorTreeBuilderValidationError
    );
  }
}

export function verifyF483Module(): {
  readonly featureId: typeof F483_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F483ControlFlowGraphDominatorTreeBuilderService();
  const sampleInput: F483ControlFlowGraphDominatorTreeBuilderInput = {
    requestId: "req_verify_f483",
    projectId: "proj_kosmora_f483",
    workspaceId: "ws_kosmora_f483",
    tenantId: "tenant_rlm_f483",
    actorId: "actor_verifier_f483",
    autonomyLevel: "A3",
    basic_blocks: "seed_f483_basic_blocks",
    cfg_directed_edges: 42,
    entry_block_id: true,
    immediate_dominators: "seed_f483_immediate_dominators",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F483" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F483" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_basic_blocks !== sampleInput.basic_blocks &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F483] Verification failed`);
  }

  return {
    featureId: F483_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
