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

export const F390_FEATURE_ID = "F390" as const;
export const F390_STAGE = "stage13-neurosymbolic-sat" as const;
export const F390_OPERATION_CODE = "F390_PURE_LITERAL_ELIMINATION_SAT_REDUCER" as const;
export const F390_CONTRACT_VERSION = "2.0.0" as const;

export type F390PureLiteralEliminationSatReducerConfig = BaseFeatureConfig<
  typeof F390_FEATURE_ID,
  typeof F390_STAGE,
  typeof F390_OPERATION_CODE
>;

export interface F390PureLiteralEliminationSatReducerInput extends BaseFeatureInput {
  readonly cnf_formula: string | number | boolean | readonly string[];
  readonly polarity_watch_list: string | number | boolean | readonly string[];
  readonly simplification_passes: string | number | boolean | readonly string[];
  readonly preserve_models: string | number | boolean | readonly string[];
}

export interface F390PureLiteralEliminationSatReducerOutput {
  readonly featureId: typeof F390_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F390_OPERATION_CODE;
  readonly resolved_cnf_formula: unknown;
  readonly resolved_polarity_watch_list: unknown;
  readonly resolved_simplification_passes: unknown;
  readonly resolved_preserve_models: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F390_FEATURE_ID>;
}

export type F390PureLiteralEliminationSatReducerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F390_FEATURE_ID
>;

export const DEFAULT_F390_CONFIG: F390PureLiteralEliminationSatReducerConfig = {
  featureId: F390_FEATURE_ID,
  stage: F390_STAGE,
  operationCode: F390_OPERATION_CODE,
  contractVersion: F390_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F390PureLiteralEliminationSatReducerValidationError extends Error {
  public readonly featureId = F390_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F390 Validation Error on '${field}']: ${message}`);
    this.name = "F390PureLiteralEliminationSatReducerValidationError";
    this.field = field;
  }
}

export function computeF390Digest(rawPayload: string): string {
  return `f390_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F390PureLiteralEliminationSatReducerService extends KosmoraFeatureAdapterBase<
  typeof F390_FEATURE_ID,
  typeof F390_STAGE,
  typeof F390_OPERATION_CODE,
  F390PureLiteralEliminationSatReducerConfig,
  F390PureLiteralEliminationSatReducerInput,
  F390PureLiteralEliminationSatReducerOutput
> {
  constructor(
    customConfig?: Partial<F390PureLiteralEliminationSatReducerConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F390_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["cnf_formula", "polarity_watch_list", "simplification_passes", "preserve_models"] as const,
      F390PureLiteralEliminationSatReducerValidationError
    );
  }
}

export function verifyF390Module(): {
  readonly featureId: typeof F390_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F390PureLiteralEliminationSatReducerService();
  const sampleInput: F390PureLiteralEliminationSatReducerInput = {
    requestId: "req_verify_f390",
    projectId: "proj_kosmora_f390",
    workspaceId: "ws_kosmora_f390",
    tenantId: "tenant_rlm_f390",
    actorId: "actor_verifier_f390",
    autonomyLevel: "A3",
    cnf_formula: "seed_f390_cnf_formula",
    polarity_watch_list: 42,
    simplification_passes: true,
    preserve_models: "seed_f390_preserve_models",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F390" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F390" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cnf_formula !== sampleInput.cnf_formula &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F390] Verification failed`);
  }

  return {
    featureId: F390_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
