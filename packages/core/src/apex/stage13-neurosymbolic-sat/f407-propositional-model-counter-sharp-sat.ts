import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage13NeurosymbolicSatKernel } from "./stage-kernel.js";

export const F407_FEATURE_ID = "F407" as const;
export const F407_STAGE = "stage13-neurosymbolic-sat" as const;
export const F407_OPERATION_CODE = "F407_PROPOSITIONAL_MODEL_COUNTER_SHARP_SAT" as const;
export const F407_CONTRACT_VERSION = "2.0.0" as const;

export type F407PropositionalModelCounterSharpSatConfig = BaseFeatureConfig<
  typeof F407_FEATURE_ID,
  typeof F407_STAGE,
  typeof F407_OPERATION_CODE
>;

export interface F407PropositionalModelCounterSharpSatInput extends BaseFeatureInput {
  readonly cnf_clauses: string | number | boolean | readonly string[];
  readonly variable_count: string | number | boolean | readonly string[];
  readonly component_partitioning: string | number | boolean | readonly string[];
  readonly exact_probability: string | number | boolean | readonly string[];
}

export interface F407PropositionalModelCounterSharpSatOutput {
  readonly featureId: typeof F407_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F407_OPERATION_CODE;
  readonly resolved_cnf_clauses: unknown;
  readonly resolved_variable_count: unknown;
  readonly resolved_component_partitioning: unknown;
  readonly resolved_exact_probability: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F407_FEATURE_ID>;
}

export type F407PropositionalModelCounterSharpSatTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F407_FEATURE_ID
>;

export const DEFAULT_F407_CONFIG: F407PropositionalModelCounterSharpSatConfig = {
  featureId: F407_FEATURE_ID,
  stage: F407_STAGE,
  operationCode: F407_OPERATION_CODE,
  contractVersion: F407_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F407PropositionalModelCounterSharpSatValidationError extends Error {
  public readonly featureId = F407_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F407 Validation Error on '${field}']: ${message}`);
    this.name = "F407PropositionalModelCounterSharpSatValidationError";
    this.field = field;
  }
}

export function computeF407Digest(rawPayload: string): string {
  return `f407_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F407PropositionalModelCounterSharpSatService extends KosmoraFeatureAdapterBase<
  typeof F407_FEATURE_ID,
  typeof F407_STAGE,
  typeof F407_OPERATION_CODE,
  F407PropositionalModelCounterSharpSatConfig,
  F407PropositionalModelCounterSharpSatInput,
  F407PropositionalModelCounterSharpSatOutput
> {
  constructor(
    customConfig?: Partial<F407PropositionalModelCounterSharpSatConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F407_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["cnf_clauses", "variable_count", "component_partitioning", "exact_probability"] as const,
      F407PropositionalModelCounterSharpSatValidationError
    );
  }
}

export function verifyF407Module(): {
  readonly featureId: typeof F407_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F407PropositionalModelCounterSharpSatService();
  const sampleInput: F407PropositionalModelCounterSharpSatInput = {
    requestId: "req_verify_f407",
    projectId: "proj_kosmora_f407",
    workspaceId: "ws_kosmora_f407",
    tenantId: "tenant_rlm_f407",
    actorId: "actor_verifier_f407",
    autonomyLevel: "A3",
    cnf_clauses: "seed_f407_cnf_clauses",
    variable_count: 42,
    component_partitioning: true,
    exact_probability: "seed_f407_exact_probability",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F407" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F407" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cnf_clauses !== sampleInput.cnf_clauses &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F407] Verification failed`);
  }

  return {
    featureId: F407_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
