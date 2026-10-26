/**
 * F195 (stage7-formal-verification): Синтезатор контрпримеров при нарушении инварианта безопасности
 * Построение кратчайшей трассы переходов от начального состояния до состояния отказа
 * Operation Code: counterexample_trace_synthesizer
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F195_FEATURE_ID = "F195" as const;
export const F195_STAGE = "stage7-formal-verification" as const;
export const F195_OPERATION_CODE = "counterexample_trace_synthesizer" as const;
export const F195_CONTRACT_VERSION = "2.0.0" as const;

export type F195CounterexampleTraceSynthesizerConfig = BaseFeatureConfig<
  typeof F195_FEATURE_ID,
  typeof F195_STAGE,
  typeof F195_OPERATION_CODE
>;

export interface F195CounterexampleTraceSynthesizerInput extends BaseFeatureInput {
  readonly model_id: string | number | boolean | readonly string[];
  readonly violated_state: string | number | boolean | readonly string[];
  readonly counterexample_length: string | number | boolean | readonly string[];
  readonly counterexample_path: string | number | boolean | readonly string[];
}

export interface F195CounterexampleTraceSynthesizerOutput {
  readonly featureId: typeof F195_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F195_OPERATION_CODE;
  readonly resolved_model_id: unknown;
  readonly resolved_violated_state: unknown;
  readonly resolved_counterexample_length: unknown;
  readonly resolved_counterexample_path: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F195_FEATURE_ID>;
}

export type F195CounterexampleTraceSynthesizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F195_FEATURE_ID>;

export const DEFAULT_F195_CONFIG: F195CounterexampleTraceSynthesizerConfig = {
  featureId: F195_FEATURE_ID,
  stage: F195_STAGE,
  operationCode: F195_OPERATION_CODE,
  contractVersion: F195_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F195CounterexampleTraceSynthesizerValidationError extends Error {
  public readonly featureId = F195_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F195 Validation Error on '${field}']: ${message}`);
    this.name = "F195CounterexampleTraceSynthesizerValidationError";
    this.field = field;
  }
}

export function computeF195Digest(rawPayload: string): string {
  return `f195_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F195CounterexampleTraceSynthesizerService extends KosmoraFeatureAdapterBase<
  typeof F195_FEATURE_ID,
  typeof F195_STAGE,
  typeof F195_OPERATION_CODE,
  F195CounterexampleTraceSynthesizerConfig,
  F195CounterexampleTraceSynthesizerInput,
  F195CounterexampleTraceSynthesizerOutput
> {
  constructor(customConfig?: Partial<F195CounterexampleTraceSynthesizerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F195_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["model_id", "violated_state", "counterexample_length", "counterexample_path"] as const,
      F195CounterexampleTraceSynthesizerValidationError
    );
  }
}

export function verifyF195Module(): {
  readonly featureId: typeof F195_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F195CounterexampleTraceSynthesizerService();
  const sampleInput: F195CounterexampleTraceSynthesizerInput = {
    requestId: "req_verify_f195",
    projectId: "proj_kosmora_f195",
    workspaceId: "ws_kosmora_f195",
    tenantId: "tenant_rlm_f195",
    actorId: "actor_verifier_f195",
    autonomyLevel: "A3",
    model_id: "seed_f195_model_id",
    violated_state: 42,
    counterexample_length: true,
    counterexample_path: "seed_f195_counterexample_path",
    metadata: { stage: "stage7-formal-verification", featureId: "F195" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F195" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_model_id !== sampleInput.model_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F195] Verification failed`);
  }

  return {
    featureId: F195_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
