/**
 * F361 (stage12-homomorphic-vdf): Вычислитель функции верифицируемой задержки y = x^(2^T) mod N (Sequential Squaring VDF)
 * Строго последовательное возведение в квадрат в группе Z_N^*, защищённое от распараллеливания
 * Operation Code: vdf_sequential_eval
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage12HomomorphicVdfKernel } from "./stage-kernel.js";

export const F361_FEATURE_ID = "F361" as const;
export const F361_STAGE = "stage12-homomorphic-vdf" as const;
export const F361_OPERATION_CODE = "vdf_sequential_eval" as const;
export const F361_CONTRACT_VERSION = "2.0.0" as const;

export type F361VdfSequentialModularSquaringEvaluatorConfig = BaseFeatureConfig<
  typeof F361_FEATURE_ID,
  typeof F361_STAGE,
  typeof F361_OPERATION_CODE
>;

export interface F361VdfSequentialModularSquaringEvaluatorInput extends BaseFeatureInput {
  readonly challenge_id: string | number | boolean | readonly string[];
  readonly input_x: string | number | boolean | readonly string[];
  readonly iterations_t: string | number | boolean | readonly string[];
  readonly output_y: string | number | boolean | readonly string[];
}

export interface F361VdfSequentialModularSquaringEvaluatorOutput {
  readonly featureId: typeof F361_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F361_OPERATION_CODE;
  readonly resolved_challenge_id: unknown;
  readonly resolved_input_x: unknown;
  readonly resolved_iterations_t: unknown;
  readonly resolved_output_y: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F361_FEATURE_ID>;
}

export type F361VdfSequentialModularSquaringEvaluatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F361_FEATURE_ID
>;

export const DEFAULT_F361_CONFIG: F361VdfSequentialModularSquaringEvaluatorConfig = {
  featureId: F361_FEATURE_ID,
  stage: F361_STAGE,
  operationCode: F361_OPERATION_CODE,
  contractVersion: F361_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F361VdfSequentialModularSquaringEvaluatorValidationError extends Error {
  public readonly featureId = F361_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F361 Validation Error on '${field}']: ${message}`);
    this.name = "F361VdfSequentialModularSquaringEvaluatorValidationError";
    this.field = field;
  }
}

export function computeF361Digest(rawPayload: string): string {
  return `f361_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F361VdfSequentialModularSquaringEvaluatorService extends KosmoraFeatureAdapterBase<
  typeof F361_FEATURE_ID,
  typeof F361_STAGE,
  typeof F361_OPERATION_CODE,
  F361VdfSequentialModularSquaringEvaluatorConfig,
  F361VdfSequentialModularSquaringEvaluatorInput,
  F361VdfSequentialModularSquaringEvaluatorOutput
> {
  constructor(
    customConfig?: Partial<F361VdfSequentialModularSquaringEvaluatorConfig>,
    kernel?: Stage12HomomorphicVdfKernel
  ) {
    super(
      DEFAULT_F361_CONFIG,
      customConfig,
      kernel ?? Stage12HomomorphicVdfKernel.getShared(),
      ["challenge_id", "input_x", "iterations_t", "output_y"] as const,
      F361VdfSequentialModularSquaringEvaluatorValidationError
    );
  }
}

export function verifyF361Module(): {
  readonly featureId: typeof F361_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F361VdfSequentialModularSquaringEvaluatorService();
  const sampleInput: F361VdfSequentialModularSquaringEvaluatorInput = {
    requestId: "req_verify_f361",
    projectId: "proj_kosmora_f361",
    workspaceId: "ws_kosmora_f361",
    tenantId: "tenant_rlm_f361",
    actorId: "actor_verifier_f361",
    autonomyLevel: "A3",
    challenge_id: "seed_f361_challenge_id",
    input_x: 42,
    iterations_t: true,
    output_y: "seed_f361_output_y",
    metadata: { stage: "stage12-homomorphic-vdf", featureId: "F361" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F361" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_challenge_id !== sampleInput.challenge_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F361] Verification failed`);
  }

  return {
    featureId: F361_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
