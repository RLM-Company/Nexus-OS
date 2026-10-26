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

export const F502_FEATURE_ID = "F502" as const;
export const F502_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F502_OPERATION_CODE = "F502_DELTA_DEBUGGING_DDMIN_FAILURE_MINIMIZER" as const;
export const F502_CONTRACT_VERSION = "2.0.0" as const;

export type F502DeltaDebuggingDdminFailureMinimizerConfig = BaseFeatureConfig<
  typeof F502_FEATURE_ID,
  typeof F502_STAGE,
  typeof F502_OPERATION_CODE
>;

export interface F502DeltaDebuggingDdminFailureMinimizerInput extends BaseFeatureInput {
  readonly failing_ast_input: string | number | boolean | readonly string[];
  readonly failure_oracle_fn: string | number | boolean | readonly string[];
  readonly minimal_1_minimal_subset: string | number | boolean | readonly string[];
  readonly reduction_ratio: string | number | boolean | readonly string[];
}

export interface F502DeltaDebuggingDdminFailureMinimizerOutput {
  readonly featureId: typeof F502_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F502_OPERATION_CODE;
  readonly resolved_failing_ast_input: unknown;
  readonly resolved_failure_oracle_fn: unknown;
  readonly resolved_minimal_1_minimal_subset: unknown;
  readonly resolved_reduction_ratio: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F502_FEATURE_ID>;
}

export type F502DeltaDebuggingDdminFailureMinimizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F502_FEATURE_ID
>;

export const DEFAULT_F502_CONFIG: F502DeltaDebuggingDdminFailureMinimizerConfig = {
  featureId: F502_FEATURE_ID,
  stage: F502_STAGE,
  operationCode: F502_OPERATION_CODE,
  contractVersion: F502_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F502DeltaDebuggingDdminFailureMinimizerValidationError extends Error {
  public readonly featureId = F502_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F502 Validation Error on '${field}']: ${message}`);
    this.name = "F502DeltaDebuggingDdminFailureMinimizerValidationError";
    this.field = field;
  }
}

export function computeF502Digest(rawPayload: string): string {
  return `f502_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F502DeltaDebuggingDdminFailureMinimizerService extends KosmoraFeatureAdapterBase<
  typeof F502_FEATURE_ID,
  typeof F502_STAGE,
  typeof F502_OPERATION_CODE,
  F502DeltaDebuggingDdminFailureMinimizerConfig,
  F502DeltaDebuggingDdminFailureMinimizerInput,
  F502DeltaDebuggingDdminFailureMinimizerOutput
> {
  constructor(
    customConfig?: Partial<F502DeltaDebuggingDdminFailureMinimizerConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F502_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "failing_ast_input",
        "failure_oracle_fn",
        "minimal_1_minimal_subset",
        "reduction_ratio"
      ] as const,
      F502DeltaDebuggingDdminFailureMinimizerValidationError
    );
  }
}

export function verifyF502Module(): {
  readonly featureId: typeof F502_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F502DeltaDebuggingDdminFailureMinimizerService();
  const sampleInput: F502DeltaDebuggingDdminFailureMinimizerInput = {
    requestId: "req_verify_f502",
    projectId: "proj_kosmora_f502",
    workspaceId: "ws_kosmora_f502",
    tenantId: "tenant_rlm_f502",
    actorId: "actor_verifier_f502",
    autonomyLevel: "A3",
    failing_ast_input: "seed_f502_failing_ast_input",
    failure_oracle_fn: 42,
    minimal_1_minimal_subset: true,
    reduction_ratio: "seed_f502_reduction_ratio",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F502" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F502" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_failing_ast_input !== sampleInput.failing_ast_input &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F502] Verification failed`);
  }

  return {
    featureId: F502_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
