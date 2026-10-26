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

export const F386_FEATURE_ID = "F386" as const;
export const F386_STAGE = "stage13-neurosymbolic-sat" as const;
export const F386_OPERATION_CODE = "F386_DPLL_BOOLEAN_SAT_UNIT_PROPAGATOR" as const;
export const F386_CONTRACT_VERSION = "2.0.0" as const;

export type F386DpllBooleanSatUnitPropagatorConfig = BaseFeatureConfig<
  typeof F386_FEATURE_ID,
  typeof F386_STAGE,
  typeof F386_OPERATION_CODE
>;

export interface F386DpllBooleanSatUnitPropagatorInput extends BaseFeatureInput {
  readonly cnf_clauses: string | number | boolean | readonly string[];
  readonly num_variables: string | number | boolean | readonly string[];
  readonly decision_heuristic: string | number | boolean | readonly string[];
  readonly conflict_limit: string | number | boolean | readonly string[];
}

export interface F386DpllBooleanSatUnitPropagatorOutput {
  readonly featureId: typeof F386_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F386_OPERATION_CODE;
  readonly resolved_cnf_clauses: unknown;
  readonly resolved_num_variables: unknown;
  readonly resolved_decision_heuristic: unknown;
  readonly resolved_conflict_limit: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F386_FEATURE_ID>;
}

export type F386DpllBooleanSatUnitPropagatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F386_FEATURE_ID>;

export const DEFAULT_F386_CONFIG: F386DpllBooleanSatUnitPropagatorConfig = {
  featureId: F386_FEATURE_ID,
  stage: F386_STAGE,
  operationCode: F386_OPERATION_CODE,
  contractVersion: F386_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F386DpllBooleanSatUnitPropagatorValidationError extends Error {
  public readonly featureId = F386_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F386 Validation Error on '${field}']: ${message}`);
    this.name = "F386DpllBooleanSatUnitPropagatorValidationError";
    this.field = field;
  }
}

export function computeF386Digest(rawPayload: string): string {
  return `f386_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F386DpllBooleanSatUnitPropagatorService extends KosmoraFeatureAdapterBase<
  typeof F386_FEATURE_ID,
  typeof F386_STAGE,
  typeof F386_OPERATION_CODE,
  F386DpllBooleanSatUnitPropagatorConfig,
  F386DpllBooleanSatUnitPropagatorInput,
  F386DpllBooleanSatUnitPropagatorOutput
> {
  constructor(customConfig?: Partial<F386DpllBooleanSatUnitPropagatorConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F386_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["cnf_clauses", "num_variables", "decision_heuristic", "conflict_limit"] as const,
      F386DpllBooleanSatUnitPropagatorValidationError
    );
  }
}

export function verifyF386Module(): {
  readonly featureId: typeof F386_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F386DpllBooleanSatUnitPropagatorService();
  const sampleInput: F386DpllBooleanSatUnitPropagatorInput = {
    requestId: "req_verify_f386",
    projectId: "proj_kosmora_f386",
    workspaceId: "ws_kosmora_f386",
    tenantId: "tenant_rlm_f386",
    actorId: "actor_verifier_f386",
    autonomyLevel: "A3",
    cnf_clauses: "seed_f386_cnf_clauses",
    num_variables: 42,
    decision_heuristic: true,
    conflict_limit: "seed_f386_conflict_limit",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F386" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F386" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cnf_clauses !== sampleInput.cnf_clauses &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F386] Verification failed`);
  }

  return {
    featureId: F386_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
