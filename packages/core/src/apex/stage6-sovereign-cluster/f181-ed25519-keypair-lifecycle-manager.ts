/**
 * F181 (stage6-sovereign-cluster): Управление ключевыми парами Ed25519 для подписи артефактов
 * Генерация и хранение асимметричных ключей Ed25519 с вычислением криптографического отпечатка публичного ключа
 * Operation Code: ed25519_keypair_lifecycle_manager
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

export const F181_FEATURE_ID = "F181" as const;
export const F181_STAGE = "stage6-sovereign-cluster" as const;
export const F181_OPERATION_CODE = "ed25519_keypair_lifecycle_manager" as const;
export const F181_CONTRACT_VERSION = "2.0.0" as const;

export type F181Ed25519KeypairLifecycleManagerExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F181Ed25519KeypairLifecycleManagerConfig = BaseFeatureConfig<
  typeof F181_FEATURE_ID,
  typeof F181_STAGE,
  typeof F181_OPERATION_CODE
>;

export interface F181Ed25519KeypairLifecycleManagerInput extends BaseFeatureInput {
  readonly key_id: string;
  readonly algorithm: string | number;
  readonly public_key_fingerprint: string | number | boolean | readonly string[];
  readonly created_at_iso: string | number | boolean | Record<string, unknown>;
}

export type F181Ed25519KeypairLifecycleManagerAuditEntry = BaseFeatureAuditEntry<
  typeof F181_FEATURE_ID
>;

export interface F181Ed25519KeypairLifecycleManagerOutput {
  readonly featureId: typeof F181_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F181Ed25519KeypairLifecycleManagerExecutionStatus;
  readonly operationCode: typeof F181_OPERATION_CODE;
  readonly resolved_key_id: string;
  readonly resolved_algorithm: string | number;
  readonly resolved_public_key_fingerprint: string | number | boolean | readonly string[];
  readonly resolved_created_at_iso: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F181Ed25519KeypairLifecycleManagerAuditEntry;
}

export type F181Ed25519KeypairLifecycleManagerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F181_FEATURE_ID
>;

export const DEFAULT_F181_CONFIG: F181Ed25519KeypairLifecycleManagerConfig = {
  featureId: F181_FEATURE_ID,
  stage: F181_STAGE,
  operationCode: F181_OPERATION_CODE,
  contractVersion: F181_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F181Ed25519KeypairLifecycleManagerValidationError extends Error {
  public readonly featureId = F181_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F181 Validation Error on '${field}']: ${message}`);
    this.name = "F181Ed25519KeypairLifecycleManagerValidationError";
    this.field = field;
  }
}

export function computeF181Digest(rawPayload: string): string {
  return `f181_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F181Ed25519KeypairLifecycleManagerEngine extends KosmoraFeatureAdapterBase<
  typeof F181_FEATURE_ID,
  typeof F181_STAGE,
  typeof F181_OPERATION_CODE,
  F181Ed25519KeypairLifecycleManagerConfig,
  F181Ed25519KeypairLifecycleManagerInput,
  F181Ed25519KeypairLifecycleManagerOutput
> {
  constructor(
    customConfig?: Partial<F181Ed25519KeypairLifecycleManagerConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F181_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["key_id", "algorithm", "public_key_fingerprint", "created_at_iso"] as const,
      F181Ed25519KeypairLifecycleManagerValidationError
    );
  }
}

export function verifyF181Module(): {
  featureId: typeof F181_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F181Ed25519KeypairLifecycleManagerEngine();
  const sampleInput: F181Ed25519KeypairLifecycleManagerInput = {
    requestId: "req_verify_f181",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    key_id: "f181_key_id_seed",
    algorithm: 42,
    public_key_fingerprint: true,
    created_at_iso: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 181 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F181" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_key_id !== sampleInput.key_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F181_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
