/**
 * F029 (stage1-autonomy): Режим «Адвокат дьявола»
 * Принудительный запуск агента-оппонента для поиска слабых мест в бизнес-плане или архитектуре
 * Operation Code: redteam_challenger
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

export const F029_FEATURE_ID = "F029" as const;
export const F029_STAGE = "stage1-autonomy" as const;
export const F029_OPERATION_CODE = "redteam_challenger" as const;
export const F029_CONTRACT_VERSION = "2.0.0" as const;

export type F029DevilsAdvocateModeExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F029DevilsAdvocateModeConfig = BaseFeatureConfig<
  typeof F029_FEATURE_ID,
  typeof F029_STAGE,
  typeof F029_OPERATION_CODE
>;

export interface F029DevilsAdvocateModeInput extends BaseFeatureInput {
  readonly challenge_id: string;
  readonly target_artifact_id: string | number;
  readonly vulnerabilities_found: string | number | boolean | readonly string[];
  readonly counter_arguments: string | number | boolean | Record<string, unknown>;
}

export type F029DevilsAdvocateModeAuditEntry = BaseFeatureAuditEntry<typeof F029_FEATURE_ID>;

export interface F029DevilsAdvocateModeOutput {
  readonly featureId: typeof F029_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F029DevilsAdvocateModeExecutionStatus;
  readonly operationCode: typeof F029_OPERATION_CODE;
  readonly resolved_challenge_id: string;
  readonly resolved_target_artifact_id: string | number;
  readonly resolved_vulnerabilities_found: string | number | boolean | readonly string[];
  readonly resolved_counter_arguments: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F029DevilsAdvocateModeAuditEntry;
}

export type F029DevilsAdvocateModeTelemetrySnapshot = BaseFeatureTelemetry<typeof F029_FEATURE_ID>;

export const DEFAULT_F029_CONFIG: F029DevilsAdvocateModeConfig = {
  featureId: F029_FEATURE_ID,
  stage: F029_STAGE,
  operationCode: F029_OPERATION_CODE,
  contractVersion: F029_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F029DevilsAdvocateModeValidationError extends Error {
  public readonly featureId = F029_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F029 Validation Error on '${field}']: ${message}`);
    this.name = "F029DevilsAdvocateModeValidationError";
    this.field = field;
  }
}

export function computeF029Digest(rawPayload: string): string {
  return `f029_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F029DevilsAdvocateModeEngine extends KosmoraFeatureAdapterBase<
  typeof F029_FEATURE_ID,
  typeof F029_STAGE,
  typeof F029_OPERATION_CODE,
  F029DevilsAdvocateModeConfig,
  F029DevilsAdvocateModeInput,
  F029DevilsAdvocateModeOutput
> {
  constructor(customConfig?: Partial<F029DevilsAdvocateModeConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F029_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["challenge_id", "target_artifact_id", "vulnerabilities_found", "counter_arguments"] as const,
      F029DevilsAdvocateModeValidationError
    );
  }
}

export function verifyF029Module(): {
  featureId: typeof F029_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F029DevilsAdvocateModeEngine();
  const sampleInput: F029DevilsAdvocateModeInput = {
    requestId: "req_verify_f029",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    challenge_id: "f029_challenge_id_seed",
    target_artifact_id: 42,
    vulnerabilities_found: true,
    counter_arguments: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 29 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F029" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_challenge_id !== sampleInput.challenge_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F029_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
