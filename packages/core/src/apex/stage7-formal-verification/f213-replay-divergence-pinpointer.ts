/**
 * F213 (stage7-formal-verification): Детектор точки расхождения (Divergence Pinpointer) при реплее траектории
 * Мгновенная локализация шага, инструмента и причины несовпадения хешей при деградации детерминизма
 * Operation Code: replay_divergence_pinpointer
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

export const F213_FEATURE_ID = "F213" as const;
export const F213_STAGE = "stage7-formal-verification" as const;
export const F213_OPERATION_CODE = "replay_divergence_pinpointer" as const;
export const F213_CONTRACT_VERSION = "2.0.0" as const;

export type F213ReplayDivergencePinpointerConfig = BaseFeatureConfig<
  typeof F213_FEATURE_ID,
  typeof F213_STAGE,
  typeof F213_OPERATION_CODE
>;

export interface F213ReplayDivergencePinpointerInput extends BaseFeatureInput {
  readonly cassette_id: string | number | boolean | readonly string[];
  readonly replay_verified: string | number | boolean | readonly string[];
  readonly divergence_step_index: string | number | boolean | readonly string[];
  readonly divergence_reason: string | number | boolean | readonly string[];
}

export interface F213ReplayDivergencePinpointerOutput {
  readonly featureId: typeof F213_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F213_OPERATION_CODE;
  readonly resolved_cassette_id: unknown;
  readonly resolved_replay_verified: unknown;
  readonly resolved_divergence_step_index: unknown;
  readonly resolved_divergence_reason: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F213_FEATURE_ID>;
}

export type F213ReplayDivergencePinpointerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F213_FEATURE_ID
>;

export const DEFAULT_F213_CONFIG: F213ReplayDivergencePinpointerConfig = {
  featureId: F213_FEATURE_ID,
  stage: F213_STAGE,
  operationCode: F213_OPERATION_CODE,
  contractVersion: F213_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F213ReplayDivergencePinpointerValidationError extends Error {
  public readonly featureId = F213_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F213 Validation Error on '${field}']: ${message}`);
    this.name = "F213ReplayDivergencePinpointerValidationError";
    this.field = field;
  }
}

export function computeF213Digest(rawPayload: string): string {
  return `f213_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F213ReplayDivergencePinpointerService extends KosmoraFeatureAdapterBase<
  typeof F213_FEATURE_ID,
  typeof F213_STAGE,
  typeof F213_OPERATION_CODE,
  F213ReplayDivergencePinpointerConfig,
  F213ReplayDivergencePinpointerInput,
  F213ReplayDivergencePinpointerOutput
> {
  constructor(
    customConfig?: Partial<F213ReplayDivergencePinpointerConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F213_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["cassette_id", "replay_verified", "divergence_step_index", "divergence_reason"] as const,
      F213ReplayDivergencePinpointerValidationError
    );
  }
}

export function verifyF213Module(): {
  readonly featureId: typeof F213_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F213ReplayDivergencePinpointerService();
  const sampleInput: F213ReplayDivergencePinpointerInput = {
    requestId: "req_verify_f213",
    projectId: "proj_kosmora_f213",
    workspaceId: "ws_kosmora_f213",
    tenantId: "tenant_rlm_f213",
    actorId: "actor_verifier_f213",
    autonomyLevel: "A3",
    cassette_id: "seed_f213_cassette_id",
    replay_verified: 42,
    divergence_step_index: true,
    divergence_reason: "seed_f213_divergence_reason",
    metadata: { stage: "stage7-formal-verification", featureId: "F213" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F213" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cassette_id !== sampleInput.cassette_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F213] Verification failed`);
  }

  return {
    featureId: F213_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
