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

export const F404_FEATURE_ID = "F404" as const;
export const F404_STAGE = "stage13-neurosymbolic-sat" as const;
export const F404_OPERATION_CODE = "F404_TEMPORAL_INTERVAL_ALLEN_ALGEBRA_PROPAGATOR" as const;
export const F404_CONTRACT_VERSION = "2.0.0" as const;

export type F404TemporalIntervalAllenAlgebraPropagatorConfig = BaseFeatureConfig<
  typeof F404_FEATURE_ID,
  typeof F404_STAGE,
  typeof F404_OPERATION_CODE
>;

export interface F404TemporalIntervalAllenAlgebraPropagatorInput extends BaseFeatureInput {
  readonly interval_nodes: string | number | boolean | readonly string[];
  readonly allen_relations: string | number | boolean | readonly string[];
  readonly composition_table_mode: string | number | boolean | readonly string[];
  readonly consistency_check: string | number | boolean | readonly string[];
}

export interface F404TemporalIntervalAllenAlgebraPropagatorOutput {
  readonly featureId: typeof F404_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F404_OPERATION_CODE;
  readonly resolved_interval_nodes: unknown;
  readonly resolved_allen_relations: unknown;
  readonly resolved_composition_table_mode: unknown;
  readonly resolved_consistency_check: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F404_FEATURE_ID>;
}

export type F404TemporalIntervalAllenAlgebraPropagatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F404_FEATURE_ID>;

export const DEFAULT_F404_CONFIG: F404TemporalIntervalAllenAlgebraPropagatorConfig = {
  featureId: F404_FEATURE_ID,
  stage: F404_STAGE,
  operationCode: F404_OPERATION_CODE,
  contractVersion: F404_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F404TemporalIntervalAllenAlgebraPropagatorValidationError extends Error {
  public readonly featureId = F404_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F404 Validation Error on '${field}']: ${message}`);
    this.name = "F404TemporalIntervalAllenAlgebraPropagatorValidationError";
    this.field = field;
  }
}

export function computeF404Digest(rawPayload: string): string {
  return `f404_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F404TemporalIntervalAllenAlgebraPropagatorService extends KosmoraFeatureAdapterBase<
  typeof F404_FEATURE_ID,
  typeof F404_STAGE,
  typeof F404_OPERATION_CODE,
  F404TemporalIntervalAllenAlgebraPropagatorConfig,
  F404TemporalIntervalAllenAlgebraPropagatorInput,
  F404TemporalIntervalAllenAlgebraPropagatorOutput
> {
  constructor(customConfig?: Partial<F404TemporalIntervalAllenAlgebraPropagatorConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F404_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["interval_nodes", "allen_relations", "composition_table_mode", "consistency_check"] as const,
      F404TemporalIntervalAllenAlgebraPropagatorValidationError
    );
  }
}

export function verifyF404Module(): {
  readonly featureId: typeof F404_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F404TemporalIntervalAllenAlgebraPropagatorService();
  const sampleInput: F404TemporalIntervalAllenAlgebraPropagatorInput = {
    requestId: "req_verify_f404",
    projectId: "proj_kosmora_f404",
    workspaceId: "ws_kosmora_f404",
    tenantId: "tenant_rlm_f404",
    actorId: "actor_verifier_f404",
    autonomyLevel: "A3",
    interval_nodes: "seed_f404_interval_nodes",
    allen_relations: 42,
    composition_table_mode: true,
    consistency_check: "seed_f404_consistency_check",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F404" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F404" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_interval_nodes !== sampleInput.interval_nodes &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F404] Verification failed`);
  }

  return {
    featureId: F404_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
