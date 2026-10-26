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

export const F510_FEATURE_ID = "F510" as const;
export const F510_STAGE = "stage16-wasm-evolutionary-synth" as const;
export const F510_OPERATION_CODE = "F510_LEMPEL_ZIV_LZ78_PHRASE_DICTIONARY_ENTROPY_CALC" as const;
export const F510_CONTRACT_VERSION = "2.0.0" as const;

export type F510LempelZivLz78PhraseDictionaryEntropyCalcConfig = BaseFeatureConfig<
  typeof F510_FEATURE_ID,
  typeof F510_STAGE,
  typeof F510_OPERATION_CODE
>;

export interface F510LempelZivLz78PhraseDictionaryEntropyCalcInput extends BaseFeatureInput {
  readonly symbol_sequence: string | number | boolean | readonly string[];
  readonly unique_lz_phrases_c: string | number | boolean | readonly string[];
  readonly asymptotic_entropy_rate: string | number | boolean | readonly string[];
  readonly repetitiveness_index: string | number | boolean | readonly string[];
}

export interface F510LempelZivLz78PhraseDictionaryEntropyCalcOutput {
  readonly featureId: typeof F510_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F510_OPERATION_CODE;
  readonly resolved_symbol_sequence: unknown;
  readonly resolved_unique_lz_phrases_c: unknown;
  readonly resolved_asymptotic_entropy_rate: unknown;
  readonly resolved_repetitiveness_index: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F510_FEATURE_ID>;
}

export type F510LempelZivLz78PhraseDictionaryEntropyCalcTelemetrySnapshot = BaseFeatureTelemetry<typeof F510_FEATURE_ID>;

export const DEFAULT_F510_CONFIG: F510LempelZivLz78PhraseDictionaryEntropyCalcConfig = {
  featureId: F510_FEATURE_ID,
  stage: F510_STAGE,
  operationCode: F510_OPERATION_CODE,
  contractVersion: F510_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F510LempelZivLz78PhraseDictionaryEntropyCalcValidationError extends Error {
  public readonly featureId = F510_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F510 Validation Error on '${field}']: ${message}`);
    this.name = "F510LempelZivLz78PhraseDictionaryEntropyCalcValidationError";
    this.field = field;
  }
}

export function computeF510Digest(rawPayload: string): string {
  return `f510_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F510LempelZivLz78PhraseDictionaryEntropyCalcService extends KosmoraFeatureAdapterBase<
  typeof F510_FEATURE_ID,
  typeof F510_STAGE,
  typeof F510_OPERATION_CODE,
  F510LempelZivLz78PhraseDictionaryEntropyCalcConfig,
  F510LempelZivLz78PhraseDictionaryEntropyCalcInput,
  F510LempelZivLz78PhraseDictionaryEntropyCalcOutput
> {
  constructor(customConfig?: Partial<F510LempelZivLz78PhraseDictionaryEntropyCalcConfig>, kernel?: Stage16WasmEvolutionarySynthKernel) {
    super(
      DEFAULT_F510_CONFIG,
      customConfig,
      kernel ?? Stage16WasmEvolutionarySynthKernel.getShared(),
      ["symbol_sequence", "unique_lz_phrases_c", "asymptotic_entropy_rate", "repetitiveness_index"] as const,
      F510LempelZivLz78PhraseDictionaryEntropyCalcValidationError
    );
  }
}

export function verifyF510Module(): {
  readonly featureId: typeof F510_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F510LempelZivLz78PhraseDictionaryEntropyCalcService();
  const sampleInput: F510LempelZivLz78PhraseDictionaryEntropyCalcInput = {
    requestId: "req_verify_f510",
    projectId: "proj_kosmora_f510",
    workspaceId: "ws_kosmora_f510",
    tenantId: "tenant_rlm_f510",
    actorId: "actor_verifier_f510",
    autonomyLevel: "A3",
    symbol_sequence: "seed_f510_symbol_sequence",
    unique_lz_phrases_c: 42,
    asymptotic_entropy_rate: true,
    repetitiveness_index: "seed_f510_repetitiveness_index",
    metadata: { stage: "stage16-wasm-evolutionary-synth", featureId: "F510" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F510" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_symbol_sequence !== sampleInput.symbol_sequence &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F510] Verification failed`);
  }

  return {
    featureId: F510_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
