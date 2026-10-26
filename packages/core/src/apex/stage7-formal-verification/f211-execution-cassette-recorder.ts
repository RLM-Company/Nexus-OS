/**
 * F211 (stage7-formal-verification): Рекордер детерминированных кассет исполнения (Execution Cassette)
 * Запись всех входов, выходов и цепочки SHA-256 хешей шагов графа для последующего воспроизведения
 * Operation Code: execution_cassette_recorder
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

export const F211_FEATURE_ID = "F211" as const;
export const F211_STAGE = "stage7-formal-verification" as const;
export const F211_OPERATION_CODE = "execution_cassette_recorder" as const;
export const F211_CONTRACT_VERSION = "2.0.0" as const;

export type F211ExecutionCassetteRecorderConfig = BaseFeatureConfig<
  typeof F211_FEATURE_ID,
  typeof F211_STAGE,
  typeof F211_OPERATION_CODE
>;

export interface F211ExecutionCassetteRecorderInput extends BaseFeatureInput {
  readonly cassette_id: string | number | boolean | readonly string[];
  readonly graph_id: string | number | boolean | readonly string[];
  readonly recorded_steps_count: string | number | boolean | readonly string[];
  readonly cassette_seal_sha256: string | number | boolean | readonly string[];
}

export interface F211ExecutionCassetteRecorderOutput {
  readonly featureId: typeof F211_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F211_OPERATION_CODE;
  readonly resolved_cassette_id: unknown;
  readonly resolved_graph_id: unknown;
  readonly resolved_recorded_steps_count: unknown;
  readonly resolved_cassette_seal_sha256: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F211_FEATURE_ID>;
}

export type F211ExecutionCassetteRecorderTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F211_FEATURE_ID
>;

export const DEFAULT_F211_CONFIG: F211ExecutionCassetteRecorderConfig = {
  featureId: F211_FEATURE_ID,
  stage: F211_STAGE,
  operationCode: F211_OPERATION_CODE,
  contractVersion: F211_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F211ExecutionCassetteRecorderValidationError extends Error {
  public readonly featureId = F211_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F211 Validation Error on '${field}']: ${message}`);
    this.name = "F211ExecutionCassetteRecorderValidationError";
    this.field = field;
  }
}

export function computeF211Digest(rawPayload: string): string {
  return `f211_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F211ExecutionCassetteRecorderService extends KosmoraFeatureAdapterBase<
  typeof F211_FEATURE_ID,
  typeof F211_STAGE,
  typeof F211_OPERATION_CODE,
  F211ExecutionCassetteRecorderConfig,
  F211ExecutionCassetteRecorderInput,
  F211ExecutionCassetteRecorderOutput
> {
  constructor(
    customConfig?: Partial<F211ExecutionCassetteRecorderConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F211_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["cassette_id", "graph_id", "recorded_steps_count", "cassette_seal_sha256"] as const,
      F211ExecutionCassetteRecorderValidationError
    );
  }
}

export function verifyF211Module(): {
  readonly featureId: typeof F211_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F211ExecutionCassetteRecorderService();
  const sampleInput: F211ExecutionCassetteRecorderInput = {
    requestId: "req_verify_f211",
    projectId: "proj_kosmora_f211",
    workspaceId: "ws_kosmora_f211",
    tenantId: "tenant_rlm_f211",
    actorId: "actor_verifier_f211",
    autonomyLevel: "A3",
    cassette_id: "seed_f211_cassette_id",
    graph_id: 42,
    recorded_steps_count: true,
    cassette_seal_sha256: "seed_f211_cassette_seal_sha256",
    metadata: { stage: "stage7-formal-verification", featureId: "F211" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F211" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cassette_id !== sampleInput.cassette_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F211] Verification failed`);
  }

  return {
    featureId: F211_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
