/**
 * F194 (stage7-formal-verification): Доказательство отсутствия взаимных блокировок (Deadlock Freedom)
 * Обнаружение терминальных тупиковых состояний в графах переходов агентов до запуска рантайма
 * Operation Code: temporal_deadlock_freedom_prover
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
import { Stage7FormalKernel } from "./stage-kernel.js";

export const F194_FEATURE_ID = "F194" as const;
export const F194_STAGE = "stage7-formal-verification" as const;
export const F194_OPERATION_CODE = "temporal_deadlock_freedom_prover" as const;
export const F194_CONTRACT_VERSION = "2.0.0" as const;

export type F194TemporalDeadlockFreedomProverConfig = BaseFeatureConfig<
  typeof F194_FEATURE_ID,
  typeof F194_STAGE,
  typeof F194_OPERATION_CODE
>;

export interface F194TemporalDeadlockFreedomProverInput extends BaseFeatureInput {
  readonly model_id: string | number | boolean | readonly string[];
  readonly deadlock_states_found: string | number | boolean | readonly string[];
  readonly terminal_states_valid: string | number | boolean | readonly string[];
  readonly proof_status: string | number | boolean | readonly string[];
}

export interface F194TemporalDeadlockFreedomProverOutput {
  readonly featureId: typeof F194_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F194_OPERATION_CODE;
  readonly resolved_model_id: unknown;
  readonly resolved_deadlock_states_found: unknown;
  readonly resolved_terminal_states_valid: unknown;
  readonly resolved_proof_status: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F194_FEATURE_ID>;
}

export type F194TemporalDeadlockFreedomProverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F194_FEATURE_ID
>;

export const DEFAULT_F194_CONFIG: F194TemporalDeadlockFreedomProverConfig = {
  featureId: F194_FEATURE_ID,
  stage: F194_STAGE,
  operationCode: F194_OPERATION_CODE,
  contractVersion: F194_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F194TemporalDeadlockFreedomProverValidationError extends Error {
  public readonly featureId = F194_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F194 Validation Error on '${field}']: ${message}`);
    this.name = "F194TemporalDeadlockFreedomProverValidationError";
    this.field = field;
  }
}

export function computeF194Digest(rawPayload: string): string {
  return `f194_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F194TemporalDeadlockFreedomProverService extends KosmoraFeatureAdapterBase<
  typeof F194_FEATURE_ID,
  typeof F194_STAGE,
  typeof F194_OPERATION_CODE,
  F194TemporalDeadlockFreedomProverConfig,
  F194TemporalDeadlockFreedomProverInput,
  F194TemporalDeadlockFreedomProverOutput
> {
  constructor(
    customConfig?: Partial<F194TemporalDeadlockFreedomProverConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F194_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["model_id", "deadlock_states_found", "terminal_states_valid", "proof_status"] as const,
      F194TemporalDeadlockFreedomProverValidationError
    );
  }
}

export function verifyF194Module(): {
  readonly featureId: typeof F194_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F194TemporalDeadlockFreedomProverService();
  const sampleInput: F194TemporalDeadlockFreedomProverInput = {
    requestId: "req_verify_f194",
    projectId: "proj_kosmora_f194",
    workspaceId: "ws_kosmora_f194",
    tenantId: "tenant_rlm_f194",
    actorId: "actor_verifier_f194",
    autonomyLevel: "A3",
    model_id: "seed_f194_model_id",
    deadlock_states_found: 42,
    terminal_states_valid: true,
    proof_status: "seed_f194_proof_status",
    metadata: { stage: "stage7-formal-verification", featureId: "F194" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F194" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_model_id !== sampleInput.model_id &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F194] Verification failed`);
  }

  return {
    featureId: F194_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
