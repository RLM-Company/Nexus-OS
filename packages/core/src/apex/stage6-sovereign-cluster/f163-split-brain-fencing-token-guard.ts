/**
 * F163 (stage6-sovereign-cluster): Защита от Split-Brain через монотонные Fencing-токены
 * Блокировка мутаций состояния от изолированных лидеров с устаревшим fencing-токеном
 * Operation Code: split_brain_fencing_token_guard
 */

import { createHash } from "node:crypto";
import {
  Stage6SovereignKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F163_FEATURE_ID = "F163" as const;
export const F163_STAGE = "stage6-sovereign-cluster" as const;
export const F163_OPERATION_CODE = "split_brain_fencing_token_guard" as const;
export const F163_CONTRACT_VERSION = "2.0.0" as const;

export type F163SplitBrainFencingTokenGuardExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F163SplitBrainFencingTokenGuardConfig = BaseFeatureConfig<
  typeof F163_FEATURE_ID,
  typeof F163_STAGE,
  typeof F163_OPERATION_CODE
>;

export interface F163SplitBrainFencingTokenGuardInput extends BaseFeatureInput {
  readonly leader_peer_id: string;
  readonly fencing_token: string | number;
  readonly expected_min_token: string | number | boolean | readonly string[];
  readonly guard_verdict: string | number | boolean | Record<string, unknown>;
}

export type F163SplitBrainFencingTokenGuardAuditEntry = BaseFeatureAuditEntry<
  typeof F163_FEATURE_ID
>;

export interface F163SplitBrainFencingTokenGuardOutput {
  readonly featureId: typeof F163_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F163SplitBrainFencingTokenGuardExecutionStatus;
  readonly operationCode: typeof F163_OPERATION_CODE;
  readonly resolved_leader_peer_id: string;
  readonly resolved_fencing_token: string | number;
  readonly resolved_expected_min_token: string | number | boolean | readonly string[];
  readonly resolved_guard_verdict: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F163SplitBrainFencingTokenGuardAuditEntry;
}

export type F163SplitBrainFencingTokenGuardTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F163_FEATURE_ID
>;

export const DEFAULT_F163_CONFIG: F163SplitBrainFencingTokenGuardConfig = {
  featureId: F163_FEATURE_ID,
  stage: F163_STAGE,
  operationCode: F163_OPERATION_CODE,
  contractVersion: F163_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F163SplitBrainFencingTokenGuardValidationError extends Error {
  public readonly featureId = F163_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F163 Validation Error on '${field}']: ${message}`);
    this.name = "F163SplitBrainFencingTokenGuardValidationError";
    this.field = field;
  }
}

export function computeF163Digest(rawPayload: string): string {
  return `f163_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F163SplitBrainFencingTokenGuardEngine extends KosmoraFeatureAdapterBase<
  typeof F163_FEATURE_ID,
  typeof F163_STAGE,
  typeof F163_OPERATION_CODE,
  F163SplitBrainFencingTokenGuardConfig,
  F163SplitBrainFencingTokenGuardInput,
  F163SplitBrainFencingTokenGuardOutput
> {
  constructor(
    customConfig?: Partial<F163SplitBrainFencingTokenGuardConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F163_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["leader_peer_id", "fencing_token", "expected_min_token", "guard_verdict"] as const,
      F163SplitBrainFencingTokenGuardValidationError
    );
  }
}

export function verifyF163Module(): {
  featureId: typeof F163_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F163SplitBrainFencingTokenGuardEngine();
  const sampleInput: F163SplitBrainFencingTokenGuardInput = {
    requestId: "req_verify_f163",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    leader_peer_id: "f163_leader_peer_id_seed",
    fencing_token: 42,
    expected_min_token: true,
    guard_verdict: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 163 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F163" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_leader_peer_id !== sampleInput.leader_peer_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F163_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
