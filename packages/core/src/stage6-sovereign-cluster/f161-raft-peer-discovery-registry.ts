/**
 * F161 (stage6-sovereign-cluster): Реестр узлов Raft-кластера и отслеживание задержек
 * Регистрация пиров кластера с верификацией endpoint, роли и задержки heartbeat
 * Operation Code: raft_peer_discovery_registry
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

export const F161_FEATURE_ID = "F161" as const;
export const F161_STAGE = "stage6-sovereign-cluster" as const;
export const F161_OPERATION_CODE = "raft_peer_discovery_registry" as const;
export const F161_CONTRACT_VERSION = "2.0.0" as const;

export type F161RaftPeerDiscoveryRegistryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F161RaftPeerDiscoveryRegistryConfig = BaseFeatureConfig<
  typeof F161_FEATURE_ID,
  typeof F161_STAGE,
  typeof F161_OPERATION_CODE
>;

export interface F161RaftPeerDiscoveryRegistryInput extends BaseFeatureInput {
  readonly peer_id: string;
  readonly endpoint_url: string | number;
  readonly voting_member: string | number | boolean | readonly string[];
  readonly latency_ms: string | number | boolean | Record<string, unknown>;
}

export type F161RaftPeerDiscoveryRegistryAuditEntry = BaseFeatureAuditEntry<typeof F161_FEATURE_ID>;

export interface F161RaftPeerDiscoveryRegistryOutput {
  readonly featureId: typeof F161_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F161RaftPeerDiscoveryRegistryExecutionStatus;
  readonly operationCode: typeof F161_OPERATION_CODE;
  readonly resolved_peer_id: string;
  readonly resolved_endpoint_url: string | number;
  readonly resolved_voting_member: string | number | boolean | readonly string[];
  readonly resolved_latency_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F161RaftPeerDiscoveryRegistryAuditEntry;
}

export type F161RaftPeerDiscoveryRegistryTelemetrySnapshot = BaseFeatureTelemetry<typeof F161_FEATURE_ID>;

export const DEFAULT_F161_CONFIG: F161RaftPeerDiscoveryRegistryConfig = {
  featureId: F161_FEATURE_ID,
  stage: F161_STAGE,
  operationCode: F161_OPERATION_CODE,
  contractVersion: F161_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F161RaftPeerDiscoveryRegistryValidationError extends Error {
  public readonly featureId = F161_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F161 Validation Error on '${field}']: ${message}`);
    this.name = "F161RaftPeerDiscoveryRegistryValidationError";
    this.field = field;
  }
}

export function computeF161Digest(rawPayload: string): string {
  return `f161_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F161RaftPeerDiscoveryRegistryEngine extends KosmoraFeatureAdapterBase<
  typeof F161_FEATURE_ID,
  typeof F161_STAGE,
  typeof F161_OPERATION_CODE,
  F161RaftPeerDiscoveryRegistryConfig,
  F161RaftPeerDiscoveryRegistryInput,
  F161RaftPeerDiscoveryRegistryOutput
> {
  constructor(customConfig?: Partial<F161RaftPeerDiscoveryRegistryConfig>, kernel?: Stage6SovereignKernel) {
    super(
      DEFAULT_F161_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["peer_id", "endpoint_url", "voting_member", "latency_ms"] as const,
      F161RaftPeerDiscoveryRegistryValidationError
    );
  }
}

export function verifyF161Module(): {
  featureId: typeof F161_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F161RaftPeerDiscoveryRegistryEngine();
  const sampleInput: F161RaftPeerDiscoveryRegistryInput = {
    requestId: "req_verify_f161",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    peer_id: "f161_peer_id_seed",
    endpoint_url: 42,
    voting_member: true,
    latency_ms: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 161 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F161" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_peer_id !== sampleInput.peer_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F161_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
