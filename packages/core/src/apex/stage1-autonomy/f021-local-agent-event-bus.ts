/**
 * F021 (stage1-autonomy): Локальная шина событий агентов (Event Bus)
 * Реактивный обмен сигналами между модулями через Pub/Sub
 * Operation Code: pubsub_bus
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

export const F021_FEATURE_ID = "F021" as const;
export const F021_STAGE = "stage1-autonomy" as const;
export const F021_OPERATION_CODE = "pubsub_bus" as const;
export const F021_CONTRACT_VERSION = "2.0.0" as const;

export type F021LocalAgentEventBusExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F021LocalAgentEventBusConfig = BaseFeatureConfig<
  typeof F021_FEATURE_ID,
  typeof F021_STAGE,
  typeof F021_OPERATION_CODE
>;

export interface F021LocalAgentEventBusInput extends BaseFeatureInput {
  readonly topic_name: string;
  readonly subscriber_count: string | number;
  readonly published_event_id: string | number | boolean | readonly string[];
  readonly delivery_latency_ms: string | number | boolean | Record<string, unknown>;
}

export type F021LocalAgentEventBusAuditEntry = BaseFeatureAuditEntry<typeof F021_FEATURE_ID>;

export interface F021LocalAgentEventBusOutput {
  readonly featureId: typeof F021_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F021LocalAgentEventBusExecutionStatus;
  readonly operationCode: typeof F021_OPERATION_CODE;
  readonly resolved_topic_name: string;
  readonly resolved_subscriber_count: string | number;
  readonly resolved_published_event_id: string | number | boolean | readonly string[];
  readonly resolved_delivery_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F021LocalAgentEventBusAuditEntry;
}

export type F021LocalAgentEventBusTelemetrySnapshot = BaseFeatureTelemetry<typeof F021_FEATURE_ID>;

export const DEFAULT_F021_CONFIG: F021LocalAgentEventBusConfig = {
  featureId: F021_FEATURE_ID,
  stage: F021_STAGE,
  operationCode: F021_OPERATION_CODE,
  contractVersion: F021_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F021LocalAgentEventBusValidationError extends Error {
  public readonly featureId = F021_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F021 Validation Error on '${field}']: ${message}`);
    this.name = "F021LocalAgentEventBusValidationError";
    this.field = field;
  }
}

export function computeF021Digest(rawPayload: string): string {
  return `f021_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F021LocalAgentEventBusEngine extends KosmoraFeatureAdapterBase<
  typeof F021_FEATURE_ID,
  typeof F021_STAGE,
  typeof F021_OPERATION_CODE,
  F021LocalAgentEventBusConfig,
  F021LocalAgentEventBusInput,
  F021LocalAgentEventBusOutput
> {
  constructor(customConfig?: Partial<F021LocalAgentEventBusConfig>, kernel?: Stage1AutonomyKernel) {
    super(
      DEFAULT_F021_CONFIG,
      customConfig,
      kernel ?? new Stage1AutonomyKernel(),
      ["topic_name", "subscriber_count", "published_event_id", "delivery_latency_ms"] as const,
      F021LocalAgentEventBusValidationError
    );
  }
}

export function verifyF021Module(): {
  featureId: typeof F021_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F021LocalAgentEventBusEngine();
  const sampleInput: F021LocalAgentEventBusInput = {
    requestId: "req_verify_f021",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    topic_name: "f021_topic_name_seed",
    subscriber_count: 42,
    published_event_id: true,
    delivery_latency_ms: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 21 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F021" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_topic_name !== sampleInput.topic_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F021_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
