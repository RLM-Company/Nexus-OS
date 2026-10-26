/**
 * F297 (stage10-game-theory): Сборщик ставок комбинаторного аукциона задач (VCG Bid Collector)
 * Приём заявок агентов с заявленной стоимостью выполнения и оценкой качества по слотам задач
 * Operation Code: vcg_bid_collector
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

export const F297_FEATURE_ID = "F297" as const;
export const F297_STAGE = "stage10-game-theory" as const;
export const F297_OPERATION_CODE = "vcg_bid_collector" as const;
export const F297_CONTRACT_VERSION = "2.0.0" as const;

export type F297VcgCombinatorialBidMatrixCollectorConfig = BaseFeatureConfig<
  typeof F297_FEATURE_ID,
  typeof F297_STAGE,
  typeof F297_OPERATION_CODE
>;

export interface F297VcgCombinatorialBidMatrixCollectorInput extends BaseFeatureInput {
  readonly auction_session_id: string | number | boolean | readonly string[];
  readonly bidder_agents: string | number | boolean | readonly string[];
  readonly task_slots: string | number | boolean | readonly string[];
  readonly reported_cost_matrix: string | number | boolean | readonly string[];
}

export interface F297VcgCombinatorialBidMatrixCollectorOutput {
  readonly featureId: typeof F297_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F297_OPERATION_CODE;
  readonly resolved_auction_session_id: unknown;
  readonly resolved_bidder_agents: unknown;
  readonly resolved_task_slots: unknown;
  readonly resolved_reported_cost_matrix: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F297_FEATURE_ID>;
}

export type F297VcgCombinatorialBidMatrixCollectorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F297_FEATURE_ID
>;

export const DEFAULT_F297_CONFIG: F297VcgCombinatorialBidMatrixCollectorConfig = {
  featureId: F297_FEATURE_ID,
  stage: F297_STAGE,
  operationCode: F297_OPERATION_CODE,
  contractVersion: F297_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F297VcgCombinatorialBidMatrixCollectorValidationError extends Error {
  public readonly featureId = F297_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F297 Validation Error on '${field}']: ${message}`);
    this.name = "F297VcgCombinatorialBidMatrixCollectorValidationError";
    this.field = field;
  }
}

export function computeF297Digest(rawPayload: string): string {
  return `f297_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F297VcgCombinatorialBidMatrixCollectorService extends KosmoraFeatureAdapterBase<
  typeof F297_FEATURE_ID,
  typeof F297_STAGE,
  typeof F297_OPERATION_CODE,
  F297VcgCombinatorialBidMatrixCollectorConfig,
  F297VcgCombinatorialBidMatrixCollectorInput,
  F297VcgCombinatorialBidMatrixCollectorOutput
> {
  constructor(
    customConfig?: Partial<F297VcgCombinatorialBidMatrixCollectorConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F297_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["auction_session_id", "bidder_agents", "task_slots", "reported_cost_matrix"] as const,
      F297VcgCombinatorialBidMatrixCollectorValidationError
    );
  }
}

export function verifyF297Module(): {
  readonly featureId: typeof F297_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F297VcgCombinatorialBidMatrixCollectorService();
  const sampleInput: F297VcgCombinatorialBidMatrixCollectorInput = {
    requestId: "req_verify_f297",
    projectId: "proj_kosmora_f297",
    workspaceId: "ws_kosmora_f297",
    tenantId: "tenant_rlm_f297",
    actorId: "actor_verifier_f297",
    autonomyLevel: "A3",
    auction_session_id: "seed_f297_auction_session_id",
    bidder_agents: 42,
    task_slots: true,
    reported_cost_matrix: "seed_f297_reported_cost_matrix",
    metadata: { stage: "stage10-game-theory", featureId: "F297" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F297" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_auction_session_id !== sampleInput.auction_session_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F297] Verification failed`);
  }

  return {
    featureId: F297_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
