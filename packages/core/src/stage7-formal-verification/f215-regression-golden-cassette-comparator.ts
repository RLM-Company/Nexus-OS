/**
 * F215 (stage7-formal-verification): Компаратор эталонных кассет (Golden Cassette) для CI/CD тестирования
 * Автоматическое сравнение нового билда агентов с эталонной записью без обращения к внешним LLM API
 * Operation Code: regression_golden_cassette_comparator
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

export const F215_FEATURE_ID = "F215" as const;
export const F215_STAGE = "stage7-formal-verification" as const;
export const F215_OPERATION_CODE = "regression_golden_cassette_comparator" as const;
export const F215_CONTRACT_VERSION = "2.0.0" as const;

export type F215RegressionGoldenCassetteComparatorConfig = BaseFeatureConfig<
  typeof F215_FEATURE_ID,
  typeof F215_STAGE,
  typeof F215_OPERATION_CODE
>;

export interface F215RegressionGoldenCassetteComparatorInput extends BaseFeatureInput {
  readonly cassette_id: string | number | boolean | readonly string[];
  readonly steps_matched: string | number | boolean | readonly string[];
  readonly replay_verified: string | number | boolean | readonly string[];
  readonly ci_gate_passed: string | number | boolean | readonly string[];
}

export interface F215RegressionGoldenCassetteComparatorOutput {
  readonly featureId: typeof F215_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F215_OPERATION_CODE;
  readonly resolved_cassette_id: unknown;
  readonly resolved_steps_matched: unknown;
  readonly resolved_replay_verified: unknown;
  readonly resolved_ci_gate_passed: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F215_FEATURE_ID>;
}

export type F215RegressionGoldenCassetteComparatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F215_FEATURE_ID>;

export const DEFAULT_F215_CONFIG: F215RegressionGoldenCassetteComparatorConfig = {
  featureId: F215_FEATURE_ID,
  stage: F215_STAGE,
  operationCode: F215_OPERATION_CODE,
  contractVersion: F215_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F215RegressionGoldenCassetteComparatorValidationError extends Error {
  public readonly featureId = F215_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F215 Validation Error on '${field}']: ${message}`);
    this.name = "F215RegressionGoldenCassetteComparatorValidationError";
    this.field = field;
  }
}

export function computeF215Digest(rawPayload: string): string {
  return `f215_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F215RegressionGoldenCassetteComparatorService extends KosmoraFeatureAdapterBase<
  typeof F215_FEATURE_ID,
  typeof F215_STAGE,
  typeof F215_OPERATION_CODE,
  F215RegressionGoldenCassetteComparatorConfig,
  F215RegressionGoldenCassetteComparatorInput,
  F215RegressionGoldenCassetteComparatorOutput
> {
  constructor(customConfig?: Partial<F215RegressionGoldenCassetteComparatorConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F215_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["cassette_id", "steps_matched", "replay_verified", "ci_gate_passed"] as const,
      F215RegressionGoldenCassetteComparatorValidationError
    );
  }
}

export function verifyF215Module(): {
  readonly featureId: typeof F215_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F215RegressionGoldenCassetteComparatorService();
  const sampleInput: F215RegressionGoldenCassetteComparatorInput = {
    requestId: "req_verify_f215",
    projectId: "proj_kosmora_f215",
    workspaceId: "ws_kosmora_f215",
    tenantId: "tenant_rlm_f215",
    actorId: "actor_verifier_f215",
    autonomyLevel: "A3",
    cassette_id: "seed_f215_cassette_id",
    steps_matched: 42,
    replay_verified: true,
    ci_gate_passed: "seed_f215_ci_gate_passed",
    metadata: { stage: "stage7-formal-verification", featureId: "F215" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F215" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_cassette_id !== sampleInput.cassette_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F215] Verification failed`);
  }

  return {
    featureId: F215_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
