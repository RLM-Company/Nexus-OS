/**
 * F341 (stage11-causal-bayesian): Селектор следующего оптимального диагностического теста по максимуму взаимной информации
 * Выбор проверки, дающей наибольшее ожидаемое сжатие энтропии апостериорного распределения
 * Operation Code: bayes_active_probe
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
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F341_FEATURE_ID = "F341" as const;
export const F341_STAGE = "stage11-causal-bayesian" as const;
export const F341_OPERATION_CODE = "bayes_active_probe" as const;
export const F341_CONTRACT_VERSION = "2.0.0" as const;

export type F341ActiveDiagnosticProbeSelectorConfig = BaseFeatureConfig<
  typeof F341_FEATURE_ID,
  typeof F341_STAGE,
  typeof F341_OPERATION_CODE
>;

export interface F341ActiveDiagnosticProbeSelectorInput extends BaseFeatureInput {
  readonly candidate_probes: string | number | boolean | readonly string[];
  readonly expected_ig_bits: string | number | boolean | readonly string[];
  readonly selected_probe_id: string | number | boolean | readonly string[];
  readonly probe_cost_ms: string | number | boolean | readonly string[];
}

export interface F341ActiveDiagnosticProbeSelectorOutput {
  readonly featureId: typeof F341_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F341_OPERATION_CODE;
  readonly resolved_candidate_probes: unknown;
  readonly resolved_expected_ig_bits: unknown;
  readonly resolved_selected_probe_id: unknown;
  readonly resolved_probe_cost_ms: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F341_FEATURE_ID>;
}

export type F341ActiveDiagnosticProbeSelectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F341_FEATURE_ID
>;

export const DEFAULT_F341_CONFIG: F341ActiveDiagnosticProbeSelectorConfig = {
  featureId: F341_FEATURE_ID,
  stage: F341_STAGE,
  operationCode: F341_OPERATION_CODE,
  contractVersion: F341_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F341ActiveDiagnosticProbeSelectorValidationError extends Error {
  public readonly featureId = F341_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F341 Validation Error on '${field}']: ${message}`);
    this.name = "F341ActiveDiagnosticProbeSelectorValidationError";
    this.field = field;
  }
}

export function computeF341Digest(rawPayload: string): string {
  return `f341_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F341ActiveDiagnosticProbeSelectorService extends KosmoraFeatureAdapterBase<
  typeof F341_FEATURE_ID,
  typeof F341_STAGE,
  typeof F341_OPERATION_CODE,
  F341ActiveDiagnosticProbeSelectorConfig,
  F341ActiveDiagnosticProbeSelectorInput,
  F341ActiveDiagnosticProbeSelectorOutput
> {
  constructor(
    customConfig?: Partial<F341ActiveDiagnosticProbeSelectorConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F341_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["candidate_probes", "expected_ig_bits", "selected_probe_id", "probe_cost_ms"] as const,
      F341ActiveDiagnosticProbeSelectorValidationError
    );
  }
}

export function verifyF341Module(): {
  readonly featureId: typeof F341_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F341ActiveDiagnosticProbeSelectorService();
  const sampleInput: F341ActiveDiagnosticProbeSelectorInput = {
    requestId: "req_verify_f341",
    projectId: "proj_kosmora_f341",
    workspaceId: "ws_kosmora_f341",
    tenantId: "tenant_rlm_f341",
    actorId: "actor_verifier_f341",
    autonomyLevel: "A3",
    candidate_probes: "seed_f341_candidate_probes",
    expected_ig_bits: 42,
    selected_probe_id: true,
    probe_cost_ms: "seed_f341_probe_cost_ms",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F341" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F341" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_probes !== sampleInput.candidate_probes &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F341] Verification failed`);
  }

  return {
    featureId: F341_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
