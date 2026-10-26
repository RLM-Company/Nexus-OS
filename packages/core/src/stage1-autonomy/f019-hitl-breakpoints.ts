/**
 * F019 (stage1-autonomy): Точки перехвата человеком (Human-in-the-Loop Breakpoints)
 * Пауза выполнения графа перед критическими действиями (удаление, пуш в прод, внешняя отправка)
 * Operation Code: hitl_gate
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

export const F019_FEATURE_ID = "F019" as const;
export const F019_STAGE = "stage1-autonomy" as const;
export const F019_OPERATION_CODE = "hitl_gate" as const;
export const F019_CONTRACT_VERSION = "2.0.0" as const;

export type F019HitlBreakpointsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F019HitlBreakpointsConfig = BaseFeatureConfig<
  typeof F019_FEATURE_ID,
  typeof F019_STAGE,
  typeof F019_OPERATION_CODE
>;

export interface F019HitlBreakpointsInput extends BaseFeatureInput {
  readonly breakpoint_id: string;
  readonly critical_action: string | number;
  readonly paused_state: string | number | boolean | readonly string[];
  readonly owner_signature: string | number | boolean | Record<string, unknown>;
}

export type F019HitlBreakpointsAuditEntry = BaseFeatureAuditEntry<typeof F019_FEATURE_ID>;

export interface F019HitlBreakpointsOutput {
  readonly featureId: typeof F019_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F019HitlBreakpointsExecutionStatus;
  readonly operationCode: typeof F019_OPERATION_CODE;
  readonly resolved_breakpoint_id: string;
  readonly resolved_critical_action: string | number;
  readonly resolved_paused_state: string | number | boolean | readonly string[];
  readonly resolved_owner_signature: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F019HitlBreakpointsAuditEntry;
}

export type F019HitlBreakpointsTelemetrySnapshot = BaseFeatureTelemetry<typeof F019_FEATURE_ID>;

export const DEFAULT_F019_CONFIG: F019HitlBreakpointsConfig = {
  featureId: F019_FEATURE_ID,
  stage: F019_STAGE,
  operationCode: F019_OPERATION_CODE,
  contractVersion: F019_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F019HitlBreakpointsValidationError extends Error {
  public readonly featureId = F019_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F019 Validation Error on '${field}']: ${message}`);
    this.name = "F019HitlBreakpointsValidationError";
    this.field = field;
  }
}

export function computeF019Digest(rawPayload: string): string {
  return `f019_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F019HitlBreakpointsEngine extends KosmoraFeatureAdapterBase<
  typeof F019_FEATURE_ID,
  typeof F019_STAGE,
  typeof F019_OPERATION_CODE,
  F019HitlBreakpointsConfig,
  F019HitlBreakpointsInput,
  F019HitlBreakpointsOutput
> {
  constructor(customConfig?: Partial<F019HitlBreakpointsConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F019_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["breakpoint_id", "critical_action", "paused_state", "owner_signature"] as const,
      F019HitlBreakpointsValidationError
    );
  }
}

export function verifyF019Module(): {
  featureId: typeof F019_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F019HitlBreakpointsEngine();
  const sampleInput: F019HitlBreakpointsInput = {
    requestId: "req_verify_f019",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    breakpoint_id: "f019_breakpoint_id_seed",
    critical_action: 42,
    paused_state: true,
    owner_signature: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 19 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F019" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_breakpoint_id !== sampleInput.breakpoint_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F019_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
