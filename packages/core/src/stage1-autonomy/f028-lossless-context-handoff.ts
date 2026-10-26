/**
 * F028 (stage1-autonomy): Передача контекста между агентами без потерь (Context Handoff)
 * Сжатие истории с сохранением ключевых фактов при передаче эстафеты
 * Operation Code: context_handoff
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

export const F028_FEATURE_ID = "F028" as const;
export const F028_STAGE = "stage1-autonomy" as const;
export const F028_OPERATION_CODE = "context_handoff" as const;
export const F028_CONTRACT_VERSION = "2.0.0" as const;

export type F028LosslessContextHandoffExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F028LosslessContextHandoffConfig = BaseFeatureConfig<
  typeof F028_FEATURE_ID,
  typeof F028_STAGE,
  typeof F028_OPERATION_CODE
>;

export interface F028LosslessContextHandoffInput extends BaseFeatureInput {
  readonly handoff_id: string;
  readonly from_role: string | number;
  readonly to_role: string | number | boolean | readonly string[];
  readonly preserved_facts_digest: string | number | boolean | Record<string, unknown>;
}

export type F028LosslessContextHandoffAuditEntry = BaseFeatureAuditEntry<typeof F028_FEATURE_ID>;

export interface F028LosslessContextHandoffOutput {
  readonly featureId: typeof F028_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F028LosslessContextHandoffExecutionStatus;
  readonly operationCode: typeof F028_OPERATION_CODE;
  readonly resolved_handoff_id: string;
  readonly resolved_from_role: string | number;
  readonly resolved_to_role: string | number | boolean | readonly string[];
  readonly resolved_preserved_facts_digest: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F028LosslessContextHandoffAuditEntry;
}

export type F028LosslessContextHandoffTelemetrySnapshot = BaseFeatureTelemetry<typeof F028_FEATURE_ID>;

export const DEFAULT_F028_CONFIG: F028LosslessContextHandoffConfig = {
  featureId: F028_FEATURE_ID,
  stage: F028_STAGE,
  operationCode: F028_OPERATION_CODE,
  contractVersion: F028_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F028LosslessContextHandoffValidationError extends Error {
  public readonly featureId = F028_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F028 Validation Error on '${field}']: ${message}`);
    this.name = "F028LosslessContextHandoffValidationError";
    this.field = field;
  }
}

export function computeF028Digest(rawPayload: string): string {
  return `f028_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F028LosslessContextHandoffEngine extends KosmoraFeatureAdapterBase<
  typeof F028_FEATURE_ID,
  typeof F028_STAGE,
  typeof F028_OPERATION_CODE,
  F028LosslessContextHandoffConfig,
  F028LosslessContextHandoffInput,
  F028LosslessContextHandoffOutput
> {
  constructor(customConfig?: Partial<F028LosslessContextHandoffConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F028_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["handoff_id", "from_role", "to_role", "preserved_facts_digest"] as const,
      F028LosslessContextHandoffValidationError
    );
  }
}

export function verifyF028Module(): {
  featureId: typeof F028_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F028LosslessContextHandoffEngine();
  const sampleInput: F028LosslessContextHandoffInput = {
    requestId: "req_verify_f028",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    handoff_id: "f028_handoff_id_seed",
    from_role: 42,
    to_role: true,
    preserved_facts_digest: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 28 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F028" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_handoff_id !== sampleInput.handoff_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F028_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
