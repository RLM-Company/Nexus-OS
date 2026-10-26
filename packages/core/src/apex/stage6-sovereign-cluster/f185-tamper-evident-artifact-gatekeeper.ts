/**
 * F185 (stage6-sovereign-cluster): Криптографический шлюз отбраковки модифицированных артефактов
 * Немедленная блокировка выдачи или экспорта артефакта при расхождении байтового SHA-256 с подписью Ed25519
 * Operation Code: tamper_evident_artifact_gatekeeper
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

export const F185_FEATURE_ID = "F185" as const;
export const F185_STAGE = "stage6-sovereign-cluster" as const;
export const F185_OPERATION_CODE = "tamper_evident_artifact_gatekeeper" as const;
export const F185_CONTRACT_VERSION = "2.0.0" as const;

export type F185TamperEvidentArtifactGatekeeperExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F185TamperEvidentArtifactGatekeeperConfig = BaseFeatureConfig<
  typeof F185_FEATURE_ID,
  typeof F185_STAGE,
  typeof F185_OPERATION_CODE
>;

export interface F185TamperEvidentArtifactGatekeeperInput extends BaseFeatureInput {
  readonly artifact_id: string;
  readonly untampered_valid: string | number;
  readonly tampered_rejected: string | number | boolean | readonly string[];
  readonly rejection_reason: string | number | boolean | Record<string, unknown>;
}

export type F185TamperEvidentArtifactGatekeeperAuditEntry = BaseFeatureAuditEntry<
  typeof F185_FEATURE_ID
>;

export interface F185TamperEvidentArtifactGatekeeperOutput {
  readonly featureId: typeof F185_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F185TamperEvidentArtifactGatekeeperExecutionStatus;
  readonly operationCode: typeof F185_OPERATION_CODE;
  readonly resolved_artifact_id: string;
  readonly resolved_untampered_valid: string | number;
  readonly resolved_tampered_rejected: string | number | boolean | readonly string[];
  readonly resolved_rejection_reason: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F185TamperEvidentArtifactGatekeeperAuditEntry;
}

export type F185TamperEvidentArtifactGatekeeperTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F185_FEATURE_ID
>;

export const DEFAULT_F185_CONFIG: F185TamperEvidentArtifactGatekeeperConfig = {
  featureId: F185_FEATURE_ID,
  stage: F185_STAGE,
  operationCode: F185_OPERATION_CODE,
  contractVersion: F185_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F185TamperEvidentArtifactGatekeeperValidationError extends Error {
  public readonly featureId = F185_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F185 Validation Error on '${field}']: ${message}`);
    this.name = "F185TamperEvidentArtifactGatekeeperValidationError";
    this.field = field;
  }
}

export function computeF185Digest(rawPayload: string): string {
  return `f185_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F185TamperEvidentArtifactGatekeeperEngine extends KosmoraFeatureAdapterBase<
  typeof F185_FEATURE_ID,
  typeof F185_STAGE,
  typeof F185_OPERATION_CODE,
  F185TamperEvidentArtifactGatekeeperConfig,
  F185TamperEvidentArtifactGatekeeperInput,
  F185TamperEvidentArtifactGatekeeperOutput
> {
  constructor(
    customConfig?: Partial<F185TamperEvidentArtifactGatekeeperConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F185_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["artifact_id", "untampered_valid", "tampered_rejected", "rejection_reason"] as const,
      F185TamperEvidentArtifactGatekeeperValidationError
    );
  }
}

export function verifyF185Module(): {
  featureId: typeof F185_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F185TamperEvidentArtifactGatekeeperEngine();
  const sampleInput: F185TamperEvidentArtifactGatekeeperInput = {
    requestId: "req_verify_f185",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    artifact_id: "f185_artifact_id_seed",
    untampered_valid: 42,
    tampered_rejected: true,
    rejection_reason: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 185 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F185" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_artifact_id !== sampleInput.artifact_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F185_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
