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

export const F508_FEATURE_ID = "F508" as const;
export const F508_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F508_OPERATION_CODE = "F508_COMPRESSION_BASED_ANOMALY_OUTLIER_DETECTOR" as const;
export const F508_CONTRACT_VERSION = "2.0.0" as const;

export type F508CompressionBasedAnomalyOutlierDetectorConfig = BaseFeatureConfig<
  typeof F508_FEATURE_ID,
  typeof F508_STAGE,
  typeof F508_OPERATION_CODE
>;

export interface F508CompressionBasedAnomalyOutlierDetectorInput extends BaseFeatureInput {
  readonly baseline_corpus_concat: string | number | boolean | readonly string[];
  readonly incoming_telemetry_record: string | number | boolean | readonly string[];
  readonly conditional_compressed_delta: string | number | boolean | readonly string[];
  readonly anomaly_flagged: string | number | boolean | readonly string[];
}

export interface F508CompressionBasedAnomalyOutlierDetectorOutput {
  readonly featureId: typeof F508_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F508_OPERATION_CODE;
  readonly resolved_baseline_corpus_concat: unknown;
  readonly resolved_incoming_telemetry_record: unknown;
  readonly resolved_conditional_compressed_delta: unknown;
  readonly resolved_anomaly_flagged: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F508_FEATURE_ID>;
}

export type F508CompressionBasedAnomalyOutlierDetectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F508_FEATURE_ID
>;

export const DEFAULT_F508_CONFIG: F508CompressionBasedAnomalyOutlierDetectorConfig = {
  featureId: F508_FEATURE_ID,
  stage: F508_STAGE,
  operationCode: F508_OPERATION_CODE,
  contractVersion: F508_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F508CompressionBasedAnomalyOutlierDetectorValidationError extends Error {
  public readonly featureId = F508_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F508 Validation Error on '${field}']: ${message}`);
    this.name = "F508CompressionBasedAnomalyOutlierDetectorValidationError";
    this.field = field;
  }
}

export function computeF508Digest(rawPayload: string): string {
  return `f508_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F508CompressionBasedAnomalyOutlierDetectorService extends KosmoraFeatureAdapterBase<
  typeof F508_FEATURE_ID,
  typeof F508_STAGE,
  typeof F508_OPERATION_CODE,
  F508CompressionBasedAnomalyOutlierDetectorConfig,
  F508CompressionBasedAnomalyOutlierDetectorInput,
  F508CompressionBasedAnomalyOutlierDetectorOutput
> {
  constructor(
    customConfig?: Partial<F508CompressionBasedAnomalyOutlierDetectorConfig>,
    kernel?: Stage16WasmEvolutionarySynthKernel
  ) {
    super(
      DEFAULT_F508_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      [
        "baseline_corpus_concat",
        "incoming_telemetry_record",
        "conditional_compressed_delta",
        "anomaly_flagged"
      ] as const,
      F508CompressionBasedAnomalyOutlierDetectorValidationError
    );
  }
}

export function verifyF508Module(): {
  readonly featureId: typeof F508_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F508CompressionBasedAnomalyOutlierDetectorService();
  const sampleInput: F508CompressionBasedAnomalyOutlierDetectorInput = {
    requestId: "req_verify_f508",
    projectId: "proj_kosmora_f508",
    workspaceId: "ws_kosmora_f508",
    tenantId: "tenant_rlm_f508",
    actorId: "actor_verifier_f508",
    autonomyLevel: "A3",
    baseline_corpus_concat: "seed_f508_baseline_corpus_concat",
    incoming_telemetry_record: 42,
    conditional_compressed_delta: true,
    anomaly_flagged: "seed_f508_anomaly_flagged",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F508" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F508" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_baseline_corpus_concat !== sampleInput.baseline_corpus_concat &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F508] Verification failed`);
  }

  return {
    featureId: F508_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
