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

export const F486_FEATURE_ID = "F486" as const;
export const F486_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F486_OPERATION_CODE = "F486_CONSTANT_FOLDING_PEEPHOLE_BYTECODE_OPTIMIZER" as const;
export const F486_CONTRACT_VERSION = "2.0.0" as const;

export type F486ConstantFoldingPeepholeBytecodeOptimizerConfig = BaseFeatureConfig<
  typeof F486_FEATURE_ID,
  typeof F486_STAGE,
  typeof F486_OPERATION_CODE
>;

export interface F486ConstantFoldingPeepholeBytecodeOptimizerInput extends BaseFeatureInput {
  readonly raw_instruction_seq: string | number | boolean | readonly string[];
  readonly peephole_window_size: string | number | boolean | readonly string[];
  readonly folded_constants_count: string | number | boolean | readonly string[];
  readonly gas_saved_estimate: string | number | boolean | readonly string[];
}

export interface F486ConstantFoldingPeepholeBytecodeOptimizerOutput {
  readonly featureId: typeof F486_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F486_OPERATION_CODE;
  readonly resolved_raw_instruction_seq: unknown;
  readonly resolved_peephole_window_size: unknown;
  readonly resolved_folded_constants_count: unknown;
  readonly resolved_gas_saved_estimate: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F486_FEATURE_ID>;
}

export type F486ConstantFoldingPeepholeBytecodeOptimizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F486_FEATURE_ID>;

export const DEFAULT_F486_CONFIG: F486ConstantFoldingPeepholeBytecodeOptimizerConfig = {
  featureId: F486_FEATURE_ID,
  stage: F486_STAGE,
  operationCode: F486_OPERATION_CODE,
  contractVersion: F486_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F486ConstantFoldingPeepholeBytecodeOptimizerValidationError extends Error {
  public readonly featureId = F486_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F486 Validation Error on '${field}']: ${message}`);
    this.name = "F486ConstantFoldingPeepholeBytecodeOptimizerValidationError";
    this.field = field;
  }
}

export function computeF486Digest(rawPayload: string): string {
  return `f486_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F486ConstantFoldingPeepholeBytecodeOptimizerService extends KosmoraFeatureAdapterBase<
  typeof F486_FEATURE_ID,
  typeof F486_STAGE,
  typeof F486_OPERATION_CODE,
  F486ConstantFoldingPeepholeBytecodeOptimizerConfig,
  F486ConstantFoldingPeepholeBytecodeOptimizerInput,
  F486ConstantFoldingPeepholeBytecodeOptimizerOutput
> {
  constructor(customConfig?: Partial<F486ConstantFoldingPeepholeBytecodeOptimizerConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F486_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["raw_instruction_seq", "peephole_window_size", "folded_constants_count", "gas_saved_estimate"] as const,
      F486ConstantFoldingPeepholeBytecodeOptimizerValidationError
    );
  }
}

export function verifyF486Module(): {
  readonly featureId: typeof F486_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F486ConstantFoldingPeepholeBytecodeOptimizerService();
  const sampleInput: F486ConstantFoldingPeepholeBytecodeOptimizerInput = {
    requestId: "req_verify_f486",
    projectId: "proj_kosmora_f486",
    workspaceId: "ws_kosmora_f486",
    tenantId: "tenant_rlm_f486",
    actorId: "actor_verifier_f486",
    autonomyLevel: "A3",
    raw_instruction_seq: "seed_f486_raw_instruction_seq",
    peephole_window_size: 42,
    folded_constants_count: true,
    gas_saved_estimate: "seed_f486_gas_saved_estimate",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F486" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F486" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_raw_instruction_seq !== sampleInput.raw_instruction_seq &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F486] Verification failed`);
  }

  return {
    featureId: F486_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
