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

export const F484_FEATURE_ID = "F484" as const;
export const F484_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F484_OPERATION_CODE = "F484_SSA_PHI_NODE_MINIMAL_INSERTION_COMPILER" as const;
export const F484_CONTRACT_VERSION = "2.0.0" as const;

export type F484SsaPhiNodeMinimalInsertionCompilerConfig = BaseFeatureConfig<
  typeof F484_FEATURE_ID,
  typeof F484_STAGE,
  typeof F484_OPERATION_CODE
>;

export interface F484SsaPhiNodeMinimalInsertionCompilerInput extends BaseFeatureInput {
  readonly dominance_frontiers: string | number | boolean | readonly string[];
  readonly variable_def_blocks: string | number | boolean | readonly string[];
  readonly inserted_phi_nodes: string | number | boolean | readonly string[];
  readonly ssa_renamed_vars: string | number | boolean | readonly string[];
}

export interface F484SsaPhiNodeMinimalInsertionCompilerOutput {
  readonly featureId: typeof F484_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F484_OPERATION_CODE;
  readonly resolved_dominance_frontiers: unknown;
  readonly resolved_variable_def_blocks: unknown;
  readonly resolved_inserted_phi_nodes: unknown;
  readonly resolved_ssa_renamed_vars: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F484_FEATURE_ID>;
}

export type F484SsaPhiNodeMinimalInsertionCompilerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F484_FEATURE_ID
>;

export const DEFAULT_F484_CONFIG: F484SsaPhiNodeMinimalInsertionCompilerConfig = {
  featureId: F484_FEATURE_ID,
  stage: F484_STAGE,
  operationCode: F484_OPERATION_CODE,
  contractVersion: F484_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F484SsaPhiNodeMinimalInsertionCompilerValidationError extends Error {
  public readonly featureId = F484_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F484 Validation Error on '${field}']: ${message}`);
    this.name = "F484SsaPhiNodeMinimalInsertionCompilerValidationError";
    this.field = field;
  }
}

export function computeF484Digest(rawPayload: string): string {
  return `f484_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F484SsaPhiNodeMinimalInsertionCompilerService extends KosmoraFeatureAdapterBase<
  typeof F484_FEATURE_ID,
  typeof F484_STAGE,
  typeof F484_OPERATION_CODE,
  F484SsaPhiNodeMinimalInsertionCompilerConfig,
  F484SsaPhiNodeMinimalInsertionCompilerInput,
  F484SsaPhiNodeMinimalInsertionCompilerOutput
> {
  constructor(
    customConfig?: Partial<F484SsaPhiNodeMinimalInsertionCompilerConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F484_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "dominance_frontiers",
        "variable_def_blocks",
        "inserted_phi_nodes",
        "ssa_renamed_vars"
      ] as const,
      F484SsaPhiNodeMinimalInsertionCompilerValidationError
    );
  }
}

export function verifyF484Module(): {
  readonly featureId: typeof F484_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F484SsaPhiNodeMinimalInsertionCompilerService();
  const sampleInput: F484SsaPhiNodeMinimalInsertionCompilerInput = {
    requestId: "req_verify_f484",
    projectId: "proj_kosmora_f484",
    workspaceId: "ws_kosmora_f484",
    tenantId: "tenant_rlm_f484",
    actorId: "actor_verifier_f484",
    autonomyLevel: "A3",
    dominance_frontiers: "seed_f484_dominance_frontiers",
    variable_def_blocks: 42,
    inserted_phi_nodes: true,
    ssa_renamed_vars: "seed_f484_ssa_renamed_vars",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F484" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F484" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_dominance_frontiers !== sampleInput.dominance_frontiers &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F484] Verification failed`);
  }

  return {
    featureId: F484_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
