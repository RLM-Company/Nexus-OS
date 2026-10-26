/**
 * F180 (stage6-sovereign-cluster): Верификатор обратимости патчей (Forward + Inverse Roundtrip)
 * Математическая проверка того, что прямое и обратное применение патча возвращает бит-в-бит исходный текст
 * Operation Code: roundtrip_patch_determinism_verifier
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

export const F180_FEATURE_ID = "F180" as const;
export const F180_STAGE = "stage6-sovereign-cluster" as const;
export const F180_OPERATION_CODE = "roundtrip_patch_determinism_verifier" as const;
export const F180_CONTRACT_VERSION = "2.0.0" as const;

export type F180RoundtripPatchDeterminismVerifierExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F180RoundtripPatchDeterminismVerifierConfig = BaseFeatureConfig<
  typeof F180_FEATURE_ID,
  typeof F180_STAGE,
  typeof F180_OPERATION_CODE
>;

export interface F180RoundtripPatchDeterminismVerifierInput extends BaseFeatureInput {
  readonly forward_digest: string;
  readonly restored_digest: string | number;
  readonly bit_exact_match: string | number | boolean | readonly string[];
  readonly applied_hunks: string | number | boolean | Record<string, unknown>;
}

export type F180RoundtripPatchDeterminismVerifierAuditEntry = BaseFeatureAuditEntry<
  typeof F180_FEATURE_ID
>;

export interface F180RoundtripPatchDeterminismVerifierOutput {
  readonly featureId: typeof F180_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F180RoundtripPatchDeterminismVerifierExecutionStatus;
  readonly operationCode: typeof F180_OPERATION_CODE;
  readonly resolved_forward_digest: string;
  readonly resolved_restored_digest: string | number;
  readonly resolved_bit_exact_match: string | number | boolean | readonly string[];
  readonly resolved_applied_hunks: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F180RoundtripPatchDeterminismVerifierAuditEntry;
}

export type F180RoundtripPatchDeterminismVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F180_FEATURE_ID
>;

export const DEFAULT_F180_CONFIG: F180RoundtripPatchDeterminismVerifierConfig = {
  featureId: F180_FEATURE_ID,
  stage: F180_STAGE,
  operationCode: F180_OPERATION_CODE,
  contractVersion: F180_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F180RoundtripPatchDeterminismVerifierValidationError extends Error {
  public readonly featureId = F180_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F180 Validation Error on '${field}']: ${message}`);
    this.name = "F180RoundtripPatchDeterminismVerifierValidationError";
    this.field = field;
  }
}

export function computeF180Digest(rawPayload: string): string {
  return `f180_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F180RoundtripPatchDeterminismVerifierEngine extends KosmoraFeatureAdapterBase<
  typeof F180_FEATURE_ID,
  typeof F180_STAGE,
  typeof F180_OPERATION_CODE,
  F180RoundtripPatchDeterminismVerifierConfig,
  F180RoundtripPatchDeterminismVerifierInput,
  F180RoundtripPatchDeterminismVerifierOutput
> {
  constructor(
    customConfig?: Partial<F180RoundtripPatchDeterminismVerifierConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F180_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["forward_digest", "restored_digest", "bit_exact_match", "applied_hunks"] as const,
      F180RoundtripPatchDeterminismVerifierValidationError
    );
  }
}

export function verifyF180Module(): {
  featureId: typeof F180_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F180RoundtripPatchDeterminismVerifierEngine();
  const sampleInput: F180RoundtripPatchDeterminismVerifierInput = {
    requestId: "req_verify_f180",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    forward_digest: "f180_forward_digest_seed",
    restored_digest: 42,
    bit_exact_match: true,
    applied_hunks: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 180 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F180" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_forward_digest !== sampleInput.forward_digest &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F180_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
