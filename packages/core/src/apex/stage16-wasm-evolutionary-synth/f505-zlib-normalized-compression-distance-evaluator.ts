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

export const F505_FEATURE_ID = "F505" as const;
export const F505_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F505_OPERATION_CODE = "F505_ZLIB_NORMALIZED_COMPRESSION_DISTANCE_EVALUATOR" as const;
export const F505_CONTRACT_VERSION = "2.0.0" as const;

export type F505ZlibNormalizedCompressionDistanceEvaluatorConfig = BaseFeatureConfig<
  typeof F505_FEATURE_ID,
  typeof F505_STAGE,
  typeof F505_OPERATION_CODE
>;

export interface F505ZlibNormalizedCompressionDistanceEvaluatorInput extends BaseFeatureInput {
  readonly payload_string_x: string | number | boolean | readonly string[];
  readonly payload_string_y: string | number | boolean | readonly string[];
  readonly deflate_level_9: string | number | boolean | readonly string[];
  readonly ncd_similarity_score: string | number | boolean | readonly string[];
}

export interface F505ZlibNormalizedCompressionDistanceEvaluatorOutput {
  readonly featureId: typeof F505_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F505_OPERATION_CODE;
  readonly resolved_payload_string_x: unknown;
  readonly resolved_payload_string_y: unknown;
  readonly resolved_deflate_level_9: unknown;
  readonly resolved_ncd_similarity_score: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F505_FEATURE_ID>;
}

export type F505ZlibNormalizedCompressionDistanceEvaluatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F505_FEATURE_ID
>;

export const DEFAULT_F505_CONFIG: F505ZlibNormalizedCompressionDistanceEvaluatorConfig = {
  featureId: F505_FEATURE_ID,
  stage: F505_STAGE,
  operationCode: F505_OPERATION_CODE,
  contractVersion: F505_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F505ZlibNormalizedCompressionDistanceEvaluatorValidationError extends Error {
  public readonly featureId = F505_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F505 Validation Error on '${field}']: ${message}`);
    this.name = "F505ZlibNormalizedCompressionDistanceEvaluatorValidationError";
    this.field = field;
  }
}

export function computeF505Digest(rawPayload: string): string {
  return `f505_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F505ZlibNormalizedCompressionDistanceEvaluatorService extends KosmoraFeatureAdapterBase<
  typeof F505_FEATURE_ID,
  typeof F505_STAGE,
  typeof F505_OPERATION_CODE,
  F505ZlibNormalizedCompressionDistanceEvaluatorConfig,
  F505ZlibNormalizedCompressionDistanceEvaluatorInput,
  F505ZlibNormalizedCompressionDistanceEvaluatorOutput
> {
  constructor(
    customConfig?: Partial<F505ZlibNormalizedCompressionDistanceEvaluatorConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F505_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["payload_string_x", "payload_string_y", "deflate_level_9", "ncd_similarity_score"] as const,
      F505ZlibNormalizedCompressionDistanceEvaluatorValidationError
    );
  }
}

export function verifyF505Module(): {
  readonly featureId: typeof F505_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F505ZlibNormalizedCompressionDistanceEvaluatorService();
  const sampleInput: F505ZlibNormalizedCompressionDistanceEvaluatorInput = {
    requestId: "req_verify_f505",
    projectId: "proj_kosmora_f505",
    workspaceId: "ws_kosmora_f505",
    tenantId: "tenant_rlm_f505",
    actorId: "actor_verifier_f505",
    autonomyLevel: "A3",
    payload_string_x: "seed_f505_payload_string_x",
    payload_string_y: 42,
    deflate_level_9: true,
    ncd_similarity_score: "seed_f505_ncd_similarity_score",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F505" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F505" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_payload_string_x !== sampleInput.payload_string_x &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F505] Verification failed`);
  }

  return {
    featureId: F505_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
