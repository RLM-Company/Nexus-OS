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

export const F392_FEATURE_ID = "F392" as const;
export const F392_STAGE = "stage13-neurosymbolic-sat" as const;
export const F392_OPERATION_CODE = "F392_DATALOG_NEGATION_AS_FAILURE_STRATIFIER" as const;
export const F392_CONTRACT_VERSION = "2.0.0" as const;

export type F392DatalogNegationAsFailureStratifierConfig = BaseFeatureConfig<
  typeof F392_FEATURE_ID,
  typeof F392_STAGE,
  typeof F392_OPERATION_CODE
>;

export interface F392DatalogNegationAsFailureStratifierInput extends BaseFeatureInput {
  readonly program_rules: string | number | boolean | readonly string[];
  readonly negated_predicates: string | number | boolean | readonly string[];
  readonly dependency_graph: string | number | boolean | readonly string[];
  readonly strict_stratification: string | number | boolean | readonly string[];
}

export interface F392DatalogNegationAsFailureStratifierOutput {
  readonly featureId: typeof F392_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F392_OPERATION_CODE;
  readonly resolved_program_rules: unknown;
  readonly resolved_negated_predicates: unknown;
  readonly resolved_dependency_graph: unknown;
  readonly resolved_strict_stratification: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F392_FEATURE_ID>;
}

export type F392DatalogNegationAsFailureStratifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F392_FEATURE_ID
>;

export const DEFAULT_F392_CONFIG: F392DatalogNegationAsFailureStratifierConfig = {
  featureId: F392_FEATURE_ID,
  stage: F392_STAGE,
  operationCode: F392_OPERATION_CODE,
  contractVersion: F392_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F392DatalogNegationAsFailureStratifierValidationError extends Error {
  public readonly featureId = F392_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F392 Validation Error on '${field}']: ${message}`);
    this.name = "F392DatalogNegationAsFailureStratifierValidationError";
    this.field = field;
  }
}

export function computeF392Digest(rawPayload: string): string {
  return `f392_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F392DatalogNegationAsFailureStratifierService extends KosmoraFeatureAdapterBase<
  typeof F392_FEATURE_ID,
  typeof F392_STAGE,
  typeof F392_OPERATION_CODE,
  F392DatalogNegationAsFailureStratifierConfig,
  F392DatalogNegationAsFailureStratifierInput,
  F392DatalogNegationAsFailureStratifierOutput
> {
  constructor(
    customConfig?: Partial<F392DatalogNegationAsFailureStratifierConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F392_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["program_rules", "negated_predicates", "dependency_graph", "strict_stratification"] as const,
      F392DatalogNegationAsFailureStratifierValidationError
    );
  }
}

export function verifyF392Module(): {
  readonly featureId: typeof F392_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F392DatalogNegationAsFailureStratifierService();
  const sampleInput: F392DatalogNegationAsFailureStratifierInput = {
    requestId: "req_verify_f392",
    projectId: "proj_kosmora_f392",
    workspaceId: "ws_kosmora_f392",
    tenantId: "tenant_rlm_f392",
    actorId: "actor_verifier_f392",
    autonomyLevel: "A3",
    program_rules: "seed_f392_program_rules",
    negated_predicates: 42,
    dependency_graph: true,
    strict_stratification: "seed_f392_strict_stratification",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F392" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F392" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_program_rules !== sampleInput.program_rules &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F392] Verification failed`);
  }

  return {
    featureId: F392_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
