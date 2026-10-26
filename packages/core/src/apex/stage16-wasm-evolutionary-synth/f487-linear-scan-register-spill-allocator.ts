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

export const F487_FEATURE_ID = "F487" as const;
export const F487_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F487_OPERATION_CODE = "F487_LINEAR_SCAN_REGISTER_SPILL_ALLOCATOR" as const;
export const F487_CONTRACT_VERSION = "2.0.0" as const;

export type F487LinearScanRegisterSpillAllocatorConfig = BaseFeatureConfig<
  typeof F487_FEATURE_ID,
  typeof F487_STAGE,
  typeof F487_OPERATION_CODE
>;

export interface F487LinearScanRegisterSpillAllocatorInput extends BaseFeatureInput {
  readonly live_intervals: string | number | boolean | readonly string[];
  readonly physical_registers_k: string | number | boolean | readonly string[];
  readonly register_assignments: string | number | boolean | readonly string[];
  readonly spilled_slots_count: string | number | boolean | readonly string[];
}

export interface F487LinearScanRegisterSpillAllocatorOutput {
  readonly featureId: typeof F487_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F487_OPERATION_CODE;
  readonly resolved_live_intervals: unknown;
  readonly resolved_physical_registers_k: unknown;
  readonly resolved_register_assignments: unknown;
  readonly resolved_spilled_slots_count: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F487_FEATURE_ID>;
}

export type F487LinearScanRegisterSpillAllocatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F487_FEATURE_ID
>;

export const DEFAULT_F487_CONFIG: F487LinearScanRegisterSpillAllocatorConfig = {
  featureId: F487_FEATURE_ID,
  stage: F487_STAGE,
  operationCode: F487_OPERATION_CODE,
  contractVersion: F487_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F487LinearScanRegisterSpillAllocatorValidationError extends Error {
  public readonly featureId = F487_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F487 Validation Error on '${field}']: ${message}`);
    this.name = "F487LinearScanRegisterSpillAllocatorValidationError";
    this.field = field;
  }
}

export function computeF487Digest(rawPayload: string): string {
  return `f487_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F487LinearScanRegisterSpillAllocatorService extends KosmoraFeatureAdapterBase<
  typeof F487_FEATURE_ID,
  typeof F487_STAGE,
  typeof F487_OPERATION_CODE,
  F487LinearScanRegisterSpillAllocatorConfig,
  F487LinearScanRegisterSpillAllocatorInput,
  F487LinearScanRegisterSpillAllocatorOutput
> {
  constructor(
    customConfig?: Partial<F487LinearScanRegisterSpillAllocatorConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F487_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "live_intervals",
        "physical_registers_k",
        "register_assignments",
        "spilled_slots_count"
      ] as const,
      F487LinearScanRegisterSpillAllocatorValidationError
    );
  }
}

export function verifyF487Module(): {
  readonly featureId: typeof F487_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F487LinearScanRegisterSpillAllocatorService();
  const sampleInput: F487LinearScanRegisterSpillAllocatorInput = {
    requestId: "req_verify_f487",
    projectId: "proj_kosmora_f487",
    workspaceId: "ws_kosmora_f487",
    tenantId: "tenant_rlm_f487",
    actorId: "actor_verifier_f487",
    autonomyLevel: "A3",
    live_intervals: "seed_f487_live_intervals",
    physical_registers_k: 42,
    register_assignments: true,
    spilled_slots_count: "seed_f487_spilled_slots_count",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F487" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F487" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_live_intervals !== sampleInput.live_intervals &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F487] Verification failed`);
  }

  return {
    featureId: F487_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
