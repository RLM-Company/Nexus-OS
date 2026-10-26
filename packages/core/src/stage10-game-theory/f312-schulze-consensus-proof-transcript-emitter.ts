/**
 * F312 (stage10-game-theory): Генератор протокола доказательства консенсуса Шульце
 * Публикация полной матрицы попарных сравнений d[i,j] и сильнейших путей p[i,j] для аудита
 * Operation Code: schulze_transcript_emit
 */

import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage10GameTheoryKernel } from "./stage-kernel.js";

export const F312_FEATURE_ID = "F312" as const;
export const F312_STAGE = "stage10-game-theory" as const;
export const F312_OPERATION_CODE = "schulze_transcript_emit" as const;
export const F312_CONTRACT_VERSION = "2.0.0" as const;

export type F312SchulzeConsensusProofTranscriptEmitterConfig = BaseFeatureConfig<
  typeof F312_FEATURE_ID,
  typeof F312_STAGE,
  typeof F312_OPERATION_CODE
>;

export interface F312SchulzeConsensusProofTranscriptEmitterInput extends BaseFeatureInput {
  readonly election_id: string | number | boolean | readonly string[];
  readonly pairwise_table: string | number | boolean | readonly string[];
  readonly beatpath_table: string | number | boolean | readonly string[];
  readonly final_ranking_order: string | number | boolean | readonly string[];
}

export interface F312SchulzeConsensusProofTranscriptEmitterOutput {
  readonly featureId: typeof F312_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F312_OPERATION_CODE;
  readonly resolved_election_id: unknown;
  readonly resolved_pairwise_table: unknown;
  readonly resolved_beatpath_table: unknown;
  readonly resolved_final_ranking_order: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F312_FEATURE_ID>;
}

export type F312SchulzeConsensusProofTranscriptEmitterTelemetrySnapshot = BaseFeatureTelemetry<typeof F312_FEATURE_ID>;

export const DEFAULT_F312_CONFIG: F312SchulzeConsensusProofTranscriptEmitterConfig = {
  featureId: F312_FEATURE_ID,
  stage: F312_STAGE,
  operationCode: F312_OPERATION_CODE,
  contractVersion: F312_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F312SchulzeConsensusProofTranscriptEmitterValidationError extends Error {
  public readonly featureId = F312_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F312 Validation Error on '${field}']: ${message}`);
    this.name = "F312SchulzeConsensusProofTranscriptEmitterValidationError";
    this.field = field;
  }
}

export function computeF312Digest(rawPayload: string): string {
  return `f312_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F312SchulzeConsensusProofTranscriptEmitterService extends KosmoraFeatureAdapterBase<
  typeof F312_FEATURE_ID,
  typeof F312_STAGE,
  typeof F312_OPERATION_CODE,
  F312SchulzeConsensusProofTranscriptEmitterConfig,
  F312SchulzeConsensusProofTranscriptEmitterInput,
  F312SchulzeConsensusProofTranscriptEmitterOutput
> {
  constructor(customConfig?: Partial<F312SchulzeConsensusProofTranscriptEmitterConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F312_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["election_id", "pairwise_table", "beatpath_table", "final_ranking_order"] as const,
      F312SchulzeConsensusProofTranscriptEmitterValidationError
    );
  }
}

export function verifyF312Module(): {
  readonly featureId: typeof F312_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F312SchulzeConsensusProofTranscriptEmitterService();
  const sampleInput: F312SchulzeConsensusProofTranscriptEmitterInput = {
    requestId: "req_verify_f312",
    projectId: "proj_kosmora_f312",
    workspaceId: "ws_kosmora_f312",
    tenantId: "tenant_rlm_f312",
    actorId: "actor_verifier_f312",
    autonomyLevel: "A3",
    election_id: "seed_f312_election_id",
    pairwise_table: 42,
    beatpath_table: true,
    final_ranking_order: "seed_f312_final_ranking_order",
    metadata: { stage: "stage10-game-theory", featureId: "F312" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F312" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_election_id !== sampleInput.election_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F312] Verification failed`);
  }

  return {
    featureId: F312_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
