/**
 * F018 (stage1-autonomy): Оценка уверенности ответа (Confidence Scoring)
 * Расчёт метрики достоверности результата перед передачей Менеджеру
 * Operation Code: confidence_estimator
 */

import { createHash } from "node:crypto";
import {
  Stage1AutonomyKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F018_FEATURE_ID = "F018" as const;
export const F018_STAGE = "stage1-autonomy" as const;
export const F018_OPERATION_CODE = "confidence_estimator" as const;
export const F018_CONTRACT_VERSION = "2.0.0" as const;

export type F018ResponseConfidenceScoringExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F018ResponseConfidenceScoringConfig = BaseFeatureConfig<
  typeof F018_FEATURE_ID,
  typeof F018_STAGE,
  typeof F018_OPERATION_CODE
>;

export interface F018ResponseConfidenceScoringInput extends BaseFeatureInput {
  readonly task_id: string;
  readonly confidence_score: string | number;
  readonly evidence_density: string | number | boolean | readonly string[];
  readonly meets_threshold: string | number | boolean | Record<string, unknown>;
}

export type F018ResponseConfidenceScoringAuditEntry = BaseFeatureAuditEntry<typeof F018_FEATURE_ID>;

export interface F018ResponseConfidenceScoringOutput {
  readonly featureId: typeof F018_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F018ResponseConfidenceScoringExecutionStatus;
  readonly operationCode: typeof F018_OPERATION_CODE;
  readonly resolved_task_id: string;
  readonly resolved_confidence_score: string | number;
  readonly resolved_evidence_density: string | number | boolean | readonly string[];
  readonly resolved_meets_threshold: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F018ResponseConfidenceScoringAuditEntry;
}

export type F018ResponseConfidenceScoringTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F018_FEATURE_ID
>;

export const DEFAULT_F018_CONFIG: F018ResponseConfidenceScoringConfig = {
  featureId: F018_FEATURE_ID,
  stage: F018_STAGE,
  operationCode: F018_OPERATION_CODE,
  contractVersion: F018_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F018ResponseConfidenceScoringValidationError extends Error {
  public readonly featureId = F018_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F018 Validation Error on '${field}']: ${message}`);
    this.name = "F018ResponseConfidenceScoringValidationError";
    this.field = field;
  }
}

export function computeF018Digest(rawPayload: string): string {
  return `f018_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F018ResponseConfidenceScoringEngine extends KosmoraFeatureAdapterBase<
  typeof F018_FEATURE_ID,
  typeof F018_STAGE,
  typeof F018_OPERATION_CODE,
  F018ResponseConfidenceScoringConfig,
  F018ResponseConfidenceScoringInput,
  F018ResponseConfidenceScoringOutput
> {
  constructor(
    customConfig?: Partial<F018ResponseConfidenceScoringConfig>,
    kernel?: Stage1AutonomyKernel
  ) {
    super(
      DEFAULT_F018_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["task_id", "confidence_score", "evidence_density", "meets_threshold"] as const,
      F018ResponseConfidenceScoringValidationError
    );
  }
  protected override validateDomainInvariants(input: F018ResponseConfidenceScoringInput): void {
    if (typeof input.confidence_score === "number" && input.confidence_score > 1000) {
      throw new F018ResponseConfidenceScoringValidationError(
        "confidence_score",
        "Metric 'confidence_score' exceeds maximum normalized ceiling (1000)."
      );
    }
  }
}

export function verifyF018Module(): {
  featureId: typeof F018_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F018ResponseConfidenceScoringEngine();
  const sampleInput: F018ResponseConfidenceScoringInput = {
    requestId: "req_verify_f018",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    task_id: "f018_task_id_seed",
    confidence_score: 42,
    evidence_density: true,
    meets_threshold: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 18 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F018" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_task_id !== sampleInput.task_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F018_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
