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

export const F482_FEATURE_ID = "F482" as const;
export const F482_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F482_OPERATION_CODE = "F482_DETERMINISTIC_GAS_METERED_BYTECODE_VM" as const;
export const F482_CONTRACT_VERSION = "2.0.0" as const;

export type F482DeterministicGasMeteredBytecodeVmConfig = BaseFeatureConfig<
  typeof F482_FEATURE_ID,
  typeof F482_STAGE,
  typeof F482_OPERATION_CODE
>;

export interface F482DeterministicGasMeteredBytecodeVmInput extends BaseFeatureInput {
  readonly bytecode_program: string | number | boolean | readonly string[];
  readonly gas_budget_limit: string | number | boolean | readonly string[];
  readonly opcode_cost_schedule: string | number | boolean | readonly string[];
  readonly memory_slot_cap: string | number | boolean | readonly string[];
}

export interface F482DeterministicGasMeteredBytecodeVmOutput {
  readonly featureId: typeof F482_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F482_OPERATION_CODE;
  readonly resolved_bytecode_program: unknown;
  readonly resolved_gas_budget_limit: unknown;
  readonly resolved_opcode_cost_schedule: unknown;
  readonly resolved_memory_slot_cap: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F482_FEATURE_ID>;
}

export type F482DeterministicGasMeteredBytecodeVmTelemetrySnapshot = BaseFeatureTelemetry<typeof F482_FEATURE_ID>;

export const DEFAULT_F482_CONFIG: F482DeterministicGasMeteredBytecodeVmConfig = {
  featureId: F482_FEATURE_ID,
  stage: F482_STAGE,
  operationCode: F482_OPERATION_CODE,
  contractVersion: F482_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F482DeterministicGasMeteredBytecodeVmValidationError extends Error {
  public readonly featureId = F482_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F482 Validation Error on '${field}']: ${message}`);
    this.name = "F482DeterministicGasMeteredBytecodeVmValidationError";
    this.field = field;
  }
}

export function computeF482Digest(rawPayload: string): string {
  return `f482_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F482DeterministicGasMeteredBytecodeVmService extends KosmoraFeatureAdapterBase<
  typeof F482_FEATURE_ID,
  typeof F482_STAGE,
  typeof F482_OPERATION_CODE,
  F482DeterministicGasMeteredBytecodeVmConfig,
  F482DeterministicGasMeteredBytecodeVmInput,
  F482DeterministicGasMeteredBytecodeVmOutput
> {
  constructor(customConfig?: Partial<F482DeterministicGasMeteredBytecodeVmConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F482_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["bytecode_program", "gas_budget_limit", "opcode_cost_schedule", "memory_slot_cap"] as const,
      F482DeterministicGasMeteredBytecodeVmValidationError
    );
  }
}

export function verifyF482Module(): {
  readonly featureId: typeof F482_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F482DeterministicGasMeteredBytecodeVmService();
  const sampleInput: F482DeterministicGasMeteredBytecodeVmInput = {
    requestId: "req_verify_f482",
    projectId: "proj_kosmora_f482",
    workspaceId: "ws_kosmora_f482",
    tenantId: "tenant_rlm_f482",
    actorId: "actor_verifier_f482",
    autonomyLevel: "A3",
    bytecode_program: "seed_f482_bytecode_program",
    gas_budget_limit: 42,
    opcode_cost_schedule: true,
    memory_slot_cap: "seed_f482_memory_slot_cap",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F482" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F482" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_bytecode_program !== sampleInput.bytecode_program &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F482] Verification failed`);
  }

  return {
    featureId: F482_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
