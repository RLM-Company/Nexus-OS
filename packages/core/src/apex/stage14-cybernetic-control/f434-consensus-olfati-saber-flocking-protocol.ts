import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage14CyberneticControlKernel } from "./stage-kernel.js";

export const F434_FEATURE_ID = "F434" as const;
export const F434_STAGE = "stage14-cybernetic-control" as const;
export const F434_OPERATION_CODE = "F434_CONSENSUS_OLFATI_SABER_FLOCKING_PROTOCOL" as const;
export const F434_CONTRACT_VERSION = "2.0.0" as const;

export type F434ConsensusOlfatiSaberFlockingProtocolConfig = BaseFeatureConfig<
  typeof F434_FEATURE_ID,
  typeof F434_STAGE,
  typeof F434_OPERATION_CODE
>;

export interface F434ConsensusOlfatiSaberFlockingProtocolInput extends BaseFeatureInput {
  readonly agent_states_initial: string | number | boolean | readonly string[];
  readonly laplacian_weights: string | number | boolean | readonly string[];
  readonly step_size_epsilon: string | number | boolean | readonly string[];
  readonly consensus_rounds: string | number | boolean | readonly string[];
}

export interface F434ConsensusOlfatiSaberFlockingProtocolOutput {
  readonly featureId: typeof F434_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F434_OPERATION_CODE;
  readonly resolved_agent_states_initial: unknown;
  readonly resolved_laplacian_weights: unknown;
  readonly resolved_step_size_epsilon: unknown;
  readonly resolved_consensus_rounds: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F434_FEATURE_ID>;
}

export type F434ConsensusOlfatiSaberFlockingProtocolTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F434_FEATURE_ID
>;

export const DEFAULT_F434_CONFIG: F434ConsensusOlfatiSaberFlockingProtocolConfig = {
  featureId: F434_FEATURE_ID,
  stage: F434_STAGE,
  operationCode: F434_OPERATION_CODE,
  contractVersion: F434_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F434ConsensusOlfatiSaberFlockingProtocolValidationError extends Error {
  public readonly featureId = F434_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F434 Validation Error on '${field}']: ${message}`);
    this.name = "F434ConsensusOlfatiSaberFlockingProtocolValidationError";
    this.field = field;
  }
}

export function computeF434Digest(rawPayload: string): string {
  return `f434_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F434ConsensusOlfatiSaberFlockingProtocolService extends KosmoraFeatureAdapterBase<
  typeof F434_FEATURE_ID,
  typeof F434_STAGE,
  typeof F434_OPERATION_CODE,
  F434ConsensusOlfatiSaberFlockingProtocolConfig,
  F434ConsensusOlfatiSaberFlockingProtocolInput,
  F434ConsensusOlfatiSaberFlockingProtocolOutput
> {
  constructor(
    customConfig?: Partial<F434ConsensusOlfatiSaberFlockingProtocolConfig>,
    kernel?: Stage14CyberneticControlKernel
  ) {
    super(
      DEFAULT_F434_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      [
        "agent_states_initial",
        "laplacian_weights",
        "step_size_epsilon",
        "consensus_rounds"
      ] as const,
      F434ConsensusOlfatiSaberFlockingProtocolValidationError
    );
  }
}

export function verifyF434Module(): {
  readonly featureId: typeof F434_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F434ConsensusOlfatiSaberFlockingProtocolService();
  const sampleInput: F434ConsensusOlfatiSaberFlockingProtocolInput = {
    requestId: "req_verify_f434",
    projectId: "proj_kosmora_f434",
    workspaceId: "ws_kosmora_f434",
    tenantId: "tenant_rlm_f434",
    actorId: "actor_verifier_f434",
    autonomyLevel: "A3",
    agent_states_initial: "seed_f434_agent_states_initial",
    laplacian_weights: 42,
    step_size_epsilon: true,
    consensus_rounds: "seed_f434_consensus_rounds",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F434" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F434" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_states_initial !== sampleInput.agent_states_initial &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F434] Verification failed`);
  }

  return {
    featureId: F434_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
