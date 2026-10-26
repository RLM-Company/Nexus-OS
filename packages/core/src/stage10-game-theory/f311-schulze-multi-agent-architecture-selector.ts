/**
 * F311 (stage10-game-theory): Селектор коллективного архитектурного решения комитета агентов
 * Выбор финального патча или стратегии рефакторинга на основе ранжированного консенсуса Шульце
 * Operation Code: schulze_arch_selector
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

export const F311_FEATURE_ID = "F311" as const;
export const F311_STAGE = "stage10-game-theory" as const;
export const F311_OPERATION_CODE = "schulze_arch_selector" as const;
export const F311_CONTRACT_VERSION = "2.0.0" as const;

export type F311SchulzeMultiAgentArchitectureSelectorConfig = BaseFeatureConfig<
  typeof F311_FEATURE_ID,
  typeof F311_STAGE,
  typeof F311_OPERATION_CODE
>;

export interface F311SchulzeMultiAgentArchitectureSelectorInput extends BaseFeatureInput {
  readonly proposal_candidates: string | number | boolean | readonly string[];
  readonly reviewer_rankings: string | number | boolean | readonly string[];
  readonly winning_proposal: string | number | boolean | readonly string[];
  readonly execution_gate: string | number | boolean | readonly string[];
}

export interface F311SchulzeMultiAgentArchitectureSelectorOutput {
  readonly featureId: typeof F311_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F311_OPERATION_CODE;
  readonly resolved_proposal_candidates: unknown;
  readonly resolved_reviewer_rankings: unknown;
  readonly resolved_winning_proposal: unknown;
  readonly resolved_execution_gate: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F311_FEATURE_ID>;
}

export type F311SchulzeMultiAgentArchitectureSelectorTelemetrySnapshot = BaseFeatureTelemetry<typeof F311_FEATURE_ID>;

export const DEFAULT_F311_CONFIG: F311SchulzeMultiAgentArchitectureSelectorConfig = {
  featureId: F311_FEATURE_ID,
  stage: F311_STAGE,
  operationCode: F311_OPERATION_CODE,
  contractVersion: F311_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F311SchulzeMultiAgentArchitectureSelectorValidationError extends Error {
  public readonly featureId = F311_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F311 Validation Error on '${field}']: ${message}`);
    this.name = "F311SchulzeMultiAgentArchitectureSelectorValidationError";
    this.field = field;
  }
}

export function computeF311Digest(rawPayload: string): string {
  return `f311_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F311SchulzeMultiAgentArchitectureSelectorService extends KosmoraFeatureAdapterBase<
  typeof F311_FEATURE_ID,
  typeof F311_STAGE,
  typeof F311_OPERATION_CODE,
  F311SchulzeMultiAgentArchitectureSelectorConfig,
  F311SchulzeMultiAgentArchitectureSelectorInput,
  F311SchulzeMultiAgentArchitectureSelectorOutput
> {
  constructor(customConfig?: Partial<F311SchulzeMultiAgentArchitectureSelectorConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F311_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["proposal_candidates", "reviewer_rankings", "winning_proposal", "execution_gate"] as const,
      F311SchulzeMultiAgentArchitectureSelectorValidationError
    );
  }
}

export function verifyF311Module(): {
  readonly featureId: typeof F311_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F311SchulzeMultiAgentArchitectureSelectorService();
  const sampleInput: F311SchulzeMultiAgentArchitectureSelectorInput = {
    requestId: "req_verify_f311",
    projectId: "proj_kosmora_f311",
    workspaceId: "ws_kosmora_f311",
    tenantId: "tenant_rlm_f311",
    actorId: "actor_verifier_f311",
    autonomyLevel: "A3",
    proposal_candidates: "seed_f311_proposal_candidates",
    reviewer_rankings: 42,
    winning_proposal: true,
    execution_gate: "seed_f311_execution_gate",
    metadata: { stage: "stage10-game-theory", featureId: "F311" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F311" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_proposal_candidates !== sampleInput.proposal_candidates &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F311] Verification failed`);
  }

  return {
    featureId: F311_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
