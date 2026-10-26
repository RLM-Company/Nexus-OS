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

export const F494_FEATURE_ID = "F494" as const;
export const F494_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F494_OPERATION_CODE = "F494_POINT_MUTATION_INSTRUCTION_PERTURBATION_ENGINE" as const;
export const F494_CONTRACT_VERSION = "2.0.0" as const;

export type F494PointMutationInstructionPerturbationEngineConfig = BaseFeatureConfig<
  typeof F494_FEATURE_ID,
  typeof F494_STAGE,
  typeof F494_OPERATION_CODE
>;

export interface F494PointMutationInstructionPerturbationEngineInput extends BaseFeatureInput {
  readonly source_bytecode: string | number | boolean | readonly string[];
  readonly mutation_rate_pm: string | number | boolean | readonly string[];
  readonly opcode_whitelist: string | number | boolean | readonly string[];
  readonly mutated_program_digest: string | number | boolean | readonly string[];
}

export interface F494PointMutationInstructionPerturbationEngineOutput {
  readonly featureId: typeof F494_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F494_OPERATION_CODE;
  readonly resolved_source_bytecode: unknown;
  readonly resolved_mutation_rate_pm: unknown;
  readonly resolved_opcode_whitelist: unknown;
  readonly resolved_mutated_program_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F494_FEATURE_ID>;
}

export type F494PointMutationInstructionPerturbationEngineTelemetrySnapshot = BaseFeatureTelemetry<typeof F494_FEATURE_ID>;

export const DEFAULT_F494_CONFIG: F494PointMutationInstructionPerturbationEngineConfig = {
  featureId: F494_FEATURE_ID,
  stage: F494_STAGE,
  operationCode: F494_OPERATION_CODE,
  contractVersion: F494_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F494PointMutationInstructionPerturbationEngineValidationError extends Error {
  public readonly featureId = F494_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F494 Validation Error on '${field}']: ${message}`);
    this.name = "F494PointMutationInstructionPerturbationEngineValidationError";
    this.field = field;
  }
}

export function computeF494Digest(rawPayload: string): string {
  return `f494_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F494PointMutationInstructionPerturbationEngineService extends KosmoraFeatureAdapterBase<
  typeof F494_FEATURE_ID,
  typeof F494_STAGE,
  typeof F494_OPERATION_CODE,
  F494PointMutationInstructionPerturbationEngineConfig,
  F494PointMutationInstructionPerturbationEngineInput,
  F494PointMutationInstructionPerturbationEngineOutput
> {
  constructor(customConfig?: Partial<F494PointMutationInstructionPerturbationEngineConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F494_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["source_bytecode", "mutation_rate_pm", "opcode_whitelist", "mutated_program_digest"] as const,
      F494PointMutationInstructionPerturbationEngineValidationError
    );
  }
}

export function verifyF494Module(): {
  readonly featureId: typeof F494_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F494PointMutationInstructionPerturbationEngineService();
  const sampleInput: F494PointMutationInstructionPerturbationEngineInput = {
    requestId: "req_verify_f494",
    projectId: "proj_kosmora_f494",
    workspaceId: "ws_kosmora_f494",
    tenantId: "tenant_rlm_f494",
    actorId: "actor_verifier_f494",
    autonomyLevel: "A3",
    source_bytecode: "seed_f494_source_bytecode",
    mutation_rate_pm: 42,
    opcode_whitelist: true,
    mutated_program_digest: "seed_f494_mutated_program_digest",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F494" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F494" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_source_bytecode !== sampleInput.source_bytecode &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F494] Verification failed`);
  }

  return {
    featureId: F494_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
