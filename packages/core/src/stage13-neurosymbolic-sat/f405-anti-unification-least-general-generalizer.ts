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

export const F405_FEATURE_ID = "F405" as const;
export const F405_STAGE = "stage13-neurosymbolic-sat" as const;
export const F405_OPERATION_CODE = "F405_ANTI_UNIFICATION_LEAST_GENERAL_GENERALIZER" as const;
export const F405_CONTRACT_VERSION = "2.0.0" as const;

export type F405AntiUnificationLeastGeneralGeneralizerConfig = BaseFeatureConfig<
  typeof F405_FEATURE_ID,
  typeof F405_STAGE,
  typeof F405_OPERATION_CODE
>;

export interface F405AntiUnificationLeastGeneralGeneralizerInput extends BaseFeatureInput {
  readonly term_pair_left: string | number | boolean | readonly string[];
  readonly term_pair_right: string | number | boolean | readonly string[];
  readonly generalization_vars: string | number | boolean | readonly string[];
  readonly type_lattice: string | number | boolean | readonly string[];
}

export interface F405AntiUnificationLeastGeneralGeneralizerOutput {
  readonly featureId: typeof F405_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F405_OPERATION_CODE;
  readonly resolved_term_pair_left: unknown;
  readonly resolved_term_pair_right: unknown;
  readonly resolved_generalization_vars: unknown;
  readonly resolved_type_lattice: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F405_FEATURE_ID>;
}

export type F405AntiUnificationLeastGeneralGeneralizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F405_FEATURE_ID>;

export const DEFAULT_F405_CONFIG: F405AntiUnificationLeastGeneralGeneralizerConfig = {
  featureId: F405_FEATURE_ID,
  stage: F405_STAGE,
  operationCode: F405_OPERATION_CODE,
  contractVersion: F405_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F405AntiUnificationLeastGeneralGeneralizerValidationError extends Error {
  public readonly featureId = F405_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F405 Validation Error on '${field}']: ${message}`);
    this.name = "F405AntiUnificationLeastGeneralGeneralizerValidationError";
    this.field = field;
  }
}

export function computeF405Digest(rawPayload: string): string {
  return `f405_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F405AntiUnificationLeastGeneralGeneralizerService extends KosmoraFeatureAdapterBase<
  typeof F405_FEATURE_ID,
  typeof F405_STAGE,
  typeof F405_OPERATION_CODE,
  F405AntiUnificationLeastGeneralGeneralizerConfig,
  F405AntiUnificationLeastGeneralGeneralizerInput,
  F405AntiUnificationLeastGeneralGeneralizerOutput
> {
  constructor(customConfig?: Partial<F405AntiUnificationLeastGeneralGeneralizerConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F405_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["term_pair_left", "term_pair_right", "generalization_vars", "type_lattice"] as const,
      F405AntiUnificationLeastGeneralGeneralizerValidationError
    );
  }
}

export function verifyF405Module(): {
  readonly featureId: typeof F405_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F405AntiUnificationLeastGeneralGeneralizerService();
  const sampleInput: F405AntiUnificationLeastGeneralGeneralizerInput = {
    requestId: "req_verify_f405",
    projectId: "proj_kosmora_f405",
    workspaceId: "ws_kosmora_f405",
    tenantId: "tenant_rlm_f405",
    actorId: "actor_verifier_f405",
    autonomyLevel: "A3",
    term_pair_left: "seed_f405_term_pair_left",
    term_pair_right: 42,
    generalization_vars: true,
    type_lattice: "seed_f405_type_lattice",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F405" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F405" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_term_pair_left !== sampleInput.term_pair_left &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F405] Verification failed`);
  }

  return {
    featureId: F405_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
