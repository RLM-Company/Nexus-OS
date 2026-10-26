/**
 * F162 (stage6-sovereign-cluster): Координатор выборов лидера с проверкой кворума
 * Проведение раунда голосования Raft с инкрементом term и выпуском монотонного fencing-токена
 * Operation Code: quorum_leader_election_coordinator
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

export const F162_FEATURE_ID = "F162" as const;
export const F162_STAGE = "stage6-sovereign-cluster" as const;
export const F162_OPERATION_CODE = "quorum_leader_election_coordinator" as const;
export const F162_CONTRACT_VERSION = "2.0.0" as const;

export type F162QuorumLeaderElectionCoordinatorExecutionStatus =
  "idle" | "validating" | "executing" | "completed" | "degraded" | "cancelled" | "failed";

export type F162QuorumLeaderElectionCoordinatorConfig = BaseFeatureConfig<
  typeof F162_FEATURE_ID,
  typeof F162_STAGE,
  typeof F162_OPERATION_CODE
>;

export interface F162QuorumLeaderElectionCoordinatorInput extends BaseFeatureInput {
  readonly candidate_peer_id: string;
  readonly term: string | number;
  readonly quorum_size: string | number | boolean | readonly string[];
  readonly fencing_token: string | number | boolean | Record<string, unknown>;
}

export type F162QuorumLeaderElectionCoordinatorAuditEntry = BaseFeatureAuditEntry<
  typeof F162_FEATURE_ID
>;

export interface F162QuorumLeaderElectionCoordinatorOutput {
  readonly featureId: typeof F162_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F162QuorumLeaderElectionCoordinatorExecutionStatus;
  readonly operationCode: typeof F162_OPERATION_CODE;
  readonly resolved_candidate_peer_id: string;
  readonly resolved_term: string | number;
  readonly resolved_quorum_size: string | number | boolean | readonly string[];
  readonly resolved_fencing_token: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F162QuorumLeaderElectionCoordinatorAuditEntry;
}

export type F162QuorumLeaderElectionCoordinatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F162_FEATURE_ID
>;

export const DEFAULT_F162_CONFIG: F162QuorumLeaderElectionCoordinatorConfig = {
  featureId: F162_FEATURE_ID,
  stage: F162_STAGE,
  operationCode: F162_OPERATION_CODE,
  contractVersion: F162_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F162QuorumLeaderElectionCoordinatorValidationError extends Error {
  public readonly featureId = F162_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F162 Validation Error on '${field}']: ${message}`);
    this.name = "F162QuorumLeaderElectionCoordinatorValidationError";
    this.field = field;
  }
}

export function computeF162Digest(rawPayload: string): string {
  return `f162_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F162QuorumLeaderElectionCoordinatorEngine extends KosmoraFeatureAdapterBase<
  typeof F162_FEATURE_ID,
  typeof F162_STAGE,
  typeof F162_OPERATION_CODE,
  F162QuorumLeaderElectionCoordinatorConfig,
  F162QuorumLeaderElectionCoordinatorInput,
  F162QuorumLeaderElectionCoordinatorOutput
> {
  constructor(
    customConfig?: Partial<F162QuorumLeaderElectionCoordinatorConfig>,
    kernel?: Stage6SovereignKernel
  ) {
    super(
      DEFAULT_F162_CONFIG,
      customConfig,
      kernel ?? new Stage6SovereignKernel(),
      ["candidate_peer_id", "term", "quorum_size", "fencing_token"] as const,
      F162QuorumLeaderElectionCoordinatorValidationError
    );
  }
}

export function verifyF162Module(): {
  featureId: typeof F162_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F162QuorumLeaderElectionCoordinatorEngine();
  const sampleInput: F162QuorumLeaderElectionCoordinatorInput = {
    requestId: "req_verify_f162",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    candidate_peer_id: "f162_candidate_peer_id_seed",
    term: 42,
    quorum_size: true,
    fencing_token: "verified_seed",
    metadata: { stage: "stage6-sovereign-cluster", featureNumber: 162 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F162" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_peer_id !== sampleInput.candidate_peer_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F162_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
