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

export const F501_FEATURE_ID = "F501" as const;
export const F501_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F501_OPERATION_CODE = "F501_PROGRAM_EQUIVALENCE_OBSERVATIONAL_INPUT_PROBER" as const;
export const F501_CONTRACT_VERSION = "2.0.0" as const;

export type F501ProgramEquivalenceObservationalInputProberConfig = BaseFeatureConfig<
  typeof F501_FEATURE_ID,
  typeof F501_STAGE,
  typeof F501_OPERATION_CODE
>;

export interface F501ProgramEquivalenceObservationalInputProberInput extends BaseFeatureInput {
  readonly candidate_program_a: string | number | boolean | readonly string[];
  readonly candidate_program_b: string | number | boolean | readonly string[];
  readonly probe_input_vectors: string | number | boolean | readonly string[];
  readonly observational_equivalent: string | number | boolean | readonly string[];
}

export interface F501ProgramEquivalenceObservationalInputProberOutput {
  readonly featureId: typeof F501_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F501_OPERATION_CODE;
  readonly resolved_candidate_program_a: unknown;
  readonly resolved_candidate_program_b: unknown;
  readonly resolved_probe_input_vectors: unknown;
  readonly resolved_observational_equivalent: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F501_FEATURE_ID>;
}

export type F501ProgramEquivalenceObservationalInputProberTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F501_FEATURE_ID
>;

export const DEFAULT_F501_CONFIG: F501ProgramEquivalenceObservationalInputProberConfig = {
  featureId: F501_FEATURE_ID,
  stage: F501_STAGE,
  operationCode: F501_OPERATION_CODE,
  contractVersion: F501_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F501ProgramEquivalenceObservationalInputProberValidationError extends Error {
  public readonly featureId = F501_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F501 Validation Error on '${field}']: ${message}`);
    this.name = "F501ProgramEquivalenceObservationalInputProberValidationError";
    this.field = field;
  }
}

export function computeF501Digest(rawPayload: string): string {
  return `f501_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F501ProgramEquivalenceObservationalInputProberService extends KosmoraFeatureAdapterBase<
  typeof F501_FEATURE_ID,
  typeof F501_STAGE,
  typeof F501_OPERATION_CODE,
  F501ProgramEquivalenceObservationalInputProberConfig,
  F501ProgramEquivalenceObservationalInputProberInput,
  F501ProgramEquivalenceObservationalInputProberOutput
> {
  constructor(
    customConfig?: Partial<F501ProgramEquivalenceObservationalInputProberConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F501_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "candidate_program_a",
        "candidate_program_b",
        "probe_input_vectors",
        "observational_equivalent"
      ] as const,
      F501ProgramEquivalenceObservationalInputProberValidationError
    );
  }
}

export function verifyF501Module(): {
  readonly featureId: typeof F501_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F501ProgramEquivalenceObservationalInputProberService();
  const sampleInput: F501ProgramEquivalenceObservationalInputProberInput = {
    requestId: "req_verify_f501",
    projectId: "proj_kosmora_f501",
    workspaceId: "ws_kosmora_f501",
    tenantId: "tenant_rlm_f501",
    actorId: "actor_verifier_f501",
    autonomyLevel: "A3",
    candidate_program_a: "seed_f501_candidate_program_a",
    candidate_program_b: 42,
    probe_input_vectors: true,
    observational_equivalent: "seed_f501_observational_equivalent",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F501" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F501" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_program_a !== sampleInput.candidate_program_a &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F501] Verification failed`);
  }

  return {
    featureId: F501_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
