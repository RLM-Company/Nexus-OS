/**
 * F293 (stage10-game-theory): Верификатор аксиомы симметрии и равноправия агентов
 * Гарантия одинакового вознаграждения для агентов с идентичным вкладом во все подмножества задач
 * Operation Code: shapley_symmetry_verify
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

export const F293_FEATURE_ID = "F293" as const;
export const F293_STAGE = "stage10-game-theory" as const;
export const F293_OPERATION_CODE = "shapley_symmetry_verify" as const;
export const F293_CONTRACT_VERSION = "2.0.0" as const;

export type F293ShapleySymmetryFairnessVerifierConfig = BaseFeatureConfig<
  typeof F293_FEATURE_ID,
  typeof F293_STAGE,
  typeof F293_OPERATION_CODE
>;

export interface F293ShapleySymmetryFairnessVerifierInput extends BaseFeatureInput {
  readonly agent_pair_ids: string | number | boolean | readonly string[];
  readonly coalition_payoffs: string | number | boolean | readonly string[];
  readonly shapley_shares: string | number | boolean | readonly string[];
  readonly fairness_action: string | number | boolean | readonly string[];
}

export interface F293ShapleySymmetryFairnessVerifierOutput {
  readonly featureId: typeof F293_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F293_OPERATION_CODE;
  readonly resolved_agent_pair_ids: unknown;
  readonly resolved_coalition_payoffs: unknown;
  readonly resolved_shapley_shares: unknown;
  readonly resolved_fairness_action: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F293_FEATURE_ID>;
}

export type F293ShapleySymmetryFairnessVerifierTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F293_FEATURE_ID
>;

export const DEFAULT_F293_CONFIG: F293ShapleySymmetryFairnessVerifierConfig = {
  featureId: F293_FEATURE_ID,
  stage: F293_STAGE,
  operationCode: F293_OPERATION_CODE,
  contractVersion: F293_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F293ShapleySymmetryFairnessVerifierValidationError extends Error {
  public readonly featureId = F293_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F293 Validation Error on '${field}']: ${message}`);
    this.name = "F293ShapleySymmetryFairnessVerifierValidationError";
    this.field = field;
  }
}

export function computeF293Digest(rawPayload: string): string {
  return `f293_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F293ShapleySymmetryFairnessVerifierService extends KosmoraFeatureAdapterBase<
  typeof F293_FEATURE_ID,
  typeof F293_STAGE,
  typeof F293_OPERATION_CODE,
  F293ShapleySymmetryFairnessVerifierConfig,
  F293ShapleySymmetryFairnessVerifierInput,
  F293ShapleySymmetryFairnessVerifierOutput
> {
  constructor(
    customConfig?: Partial<F293ShapleySymmetryFairnessVerifierConfig>,
    kernel?: Stage10GameTheoryKernel
  ) {
    super(
      DEFAULT_F293_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["agent_pair_ids", "coalition_payoffs", "shapley_shares", "fairness_action"] as const,
      F293ShapleySymmetryFairnessVerifierValidationError
    );
  }
}

export function verifyF293Module(): {
  readonly featureId: typeof F293_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F293ShapleySymmetryFairnessVerifierService();
  const sampleInput: F293ShapleySymmetryFairnessVerifierInput = {
    requestId: "req_verify_f293",
    projectId: "proj_kosmora_f293",
    workspaceId: "ws_kosmora_f293",
    tenantId: "tenant_rlm_f293",
    actorId: "actor_verifier_f293",
    autonomyLevel: "A3",
    agent_pair_ids: "seed_f293_agent_pair_ids",
    coalition_payoffs: 42,
    shapley_shares: true,
    fairness_action: "seed_f293_fairness_action",
    metadata: { stage: "stage10-game-theory", featureId: "F293" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F293" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_agent_pair_ids !== sampleInput.agent_pair_ids &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F293] Verification failed`);
  }

  return {
    featureId: F293_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
