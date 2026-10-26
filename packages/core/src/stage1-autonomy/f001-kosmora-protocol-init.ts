/**
 * F001 (stage1-autonomy): Инициализация протокола Kosmora
 * Единый стандарт обмена сообщениями и состояниями между оркестратором и воркерами
 * Operation Code: protocol_handshake
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

export const F001_FEATURE_ID = "F001" as const;
export const F001_STAGE = "stage1-autonomy" as const;
export const F001_OPERATION_CODE = "protocol_handshake" as const;
export const F001_CONTRACT_VERSION = "2.0.0" as const;

export type F001KosmoraProtocolInitExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F001KosmoraProtocolInitConfig = BaseFeatureConfig<
  typeof F001_FEATURE_ID,
  typeof F001_STAGE,
  typeof F001_OPERATION_CODE
>;

export interface F001KosmoraProtocolInitInput extends BaseFeatureInput {
  readonly protocol_version: string;
  readonly sender_role: string | number;
  readonly recipient_role: string | number | boolean | readonly string[];
  readonly correlation_id: string | number | boolean | Record<string, unknown>;
}

export type F001KosmoraProtocolInitAuditEntry = BaseFeatureAuditEntry<typeof F001_FEATURE_ID>;

export interface F001KosmoraProtocolInitOutput {
  readonly featureId: typeof F001_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F001KosmoraProtocolInitExecutionStatus;
  readonly operationCode: typeof F001_OPERATION_CODE;
  readonly resolved_protocol_version: string;
  readonly resolved_sender_role: string | number;
  readonly resolved_recipient_role: string | number | boolean | readonly string[];
  readonly resolved_correlation_id: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F001KosmoraProtocolInitAuditEntry;
}

export type F001KosmoraProtocolInitTelemetrySnapshot = BaseFeatureTelemetry<typeof F001_FEATURE_ID>;

export const DEFAULT_F001_CONFIG: F001KosmoraProtocolInitConfig = {
  featureId: F001_FEATURE_ID,
  stage: F001_STAGE,
  operationCode: F001_OPERATION_CODE,
  contractVersion: F001_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F001KosmoraProtocolInitValidationError extends Error {
  public readonly featureId = F001_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F001 Validation Error on '${field}']: ${message}`);
    this.name = "F001KosmoraProtocolInitValidationError";
    this.field = field;
  }
}

export function computeF001Digest(rawPayload: string): string {
  return `f001_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F001KosmoraProtocolInitEngine extends KosmoraFeatureAdapterBase<
  typeof F001_FEATURE_ID,
  typeof F001_STAGE,
  typeof F001_OPERATION_CODE,
  F001KosmoraProtocolInitConfig,
  F001KosmoraProtocolInitInput,
  F001KosmoraProtocolInitOutput
> {
  constructor(customConfig?: Partial<F001KosmoraProtocolInitConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F001_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["protocol_version", "sender_role", "recipient_role", "correlation_id"] as const,
      F001KosmoraProtocolInitValidationError
    );
  }
}

export function verifyF001Module(): {
  featureId: typeof F001_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F001KosmoraProtocolInitEngine();
  const sampleInput: F001KosmoraProtocolInitInput = {
    requestId: "req_verify_f001",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    protocol_version: "f001_protocol_version_seed",
    sender_role: 42,
    recipient_role: true,
    correlation_id: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 1 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F001" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_protocol_version !== sampleInput.protocol_version &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F001_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
