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

export const F396_FEATURE_ID = "F396" as const;
export const F396_STAGE = "stage13-neurosymbolic-sat" as const;
export const F396_OPERATION_CODE = "F396_DEFEASIBLE_ARGUMENTATION_EXTENSION_SOLVER" as const;
export const F396_CONTRACT_VERSION = "2.0.0" as const;

export type F396DefeasibleArgumentationExtensionSolverConfig = BaseFeatureConfig<
  typeof F396_FEATURE_ID,
  typeof F396_STAGE,
  typeof F396_OPERATION_CODE
>;

export interface F396DefeasibleArgumentationExtensionSolverInput extends BaseFeatureInput {
  readonly arguments_set: string | number | boolean | readonly string[];
  readonly attack_relations: string | number | boolean | readonly string[];
  readonly semantics_mode: string | number | boolean | readonly string[];
  readonly preference_weights: string | number | boolean | readonly string[];
}

export interface F396DefeasibleArgumentationExtensionSolverOutput {
  readonly featureId: typeof F396_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F396_OPERATION_CODE;
  readonly resolved_arguments_set: unknown;
  readonly resolved_attack_relations: unknown;
  readonly resolved_semantics_mode: unknown;
  readonly resolved_preference_weights: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F396_FEATURE_ID>;
}

export type F396DefeasibleArgumentationExtensionSolverTelemetrySnapshot = BaseFeatureTelemetry<typeof F396_FEATURE_ID>;

export const DEFAULT_F396_CONFIG: F396DefeasibleArgumentationExtensionSolverConfig = {
  featureId: F396_FEATURE_ID,
  stage: F396_STAGE,
  operationCode: F396_OPERATION_CODE,
  contractVersion: F396_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F396DefeasibleArgumentationExtensionSolverValidationError extends Error {
  public readonly featureId = F396_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F396 Validation Error on '${field}']: ${message}`);
    this.name = "F396DefeasibleArgumentationExtensionSolverValidationError";
    this.field = field;
  }
}

export function computeF396Digest(rawPayload: string): string {
  return `f396_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F396DefeasibleArgumentationExtensionSolverService extends KosmoraFeatureAdapterBase<
  typeof F396_FEATURE_ID,
  typeof F396_STAGE,
  typeof F396_OPERATION_CODE,
  F396DefeasibleArgumentationExtensionSolverConfig,
  F396DefeasibleArgumentationExtensionSolverInput,
  F396DefeasibleArgumentationExtensionSolverOutput
> {
  constructor(customConfig?: Partial<F396DefeasibleArgumentationExtensionSolverConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F396_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["arguments_set", "attack_relations", "semantics_mode", "preference_weights"] as const,
      F396DefeasibleArgumentationExtensionSolverValidationError
    );
  }
}

export function verifyF396Module(): {
  readonly featureId: typeof F396_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F396DefeasibleArgumentationExtensionSolverService();
  const sampleInput: F396DefeasibleArgumentationExtensionSolverInput = {
    requestId: "req_verify_f396",
    projectId: "proj_kosmora_f396",
    workspaceId: "ws_kosmora_f396",
    tenantId: "tenant_rlm_f396",
    actorId: "actor_verifier_f396",
    autonomyLevel: "A3",
    arguments_set: "seed_f396_arguments_set",
    attack_relations: 42,
    semantics_mode: true,
    preference_weights: "seed_f396_preference_weights",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F396" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F396" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_arguments_set !== sampleInput.arguments_set &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F396] Verification failed`);
  }

  return {
    featureId: F396_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
