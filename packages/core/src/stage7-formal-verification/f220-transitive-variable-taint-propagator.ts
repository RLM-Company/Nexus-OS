/**
 * F220 (stage7-formal-verification): Анализатор транзитивного заражения переменных через цепочки присваиваний
 * Выявление скрытых потоков данных вида a = req.body; b = a; eval(b) при многошаговых трансформациях
 * Operation Code: transitive_variable_taint_propagator
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

export const F220_FEATURE_ID = "F220" as const;
export const F220_STAGE = "stage7-formal-verification" as const;
export const F220_OPERATION_CODE = "transitive_variable_taint_propagator" as const;
export const F220_CONTRACT_VERSION = "2.0.0" as const;

export type F220TransitiveVariableTaintPropagatorConfig = BaseFeatureConfig<
  typeof F220_FEATURE_ID,
  typeof F220_STAGE,
  typeof F220_OPERATION_CODE
>;

export interface F220TransitiveVariableTaintPropagatorInput extends BaseFeatureInput {
  readonly tainted_chain: string | number | boolean | readonly string[];
  readonly violations_count: string | number | boolean | readonly string[];
  readonly safe: string | number | boolean | readonly string[];
  readonly analysis_digest: string | number | boolean | readonly string[];
}

export interface F220TransitiveVariableTaintPropagatorOutput {
  readonly featureId: typeof F220_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F220_OPERATION_CODE;
  readonly resolved_tainted_chain: unknown;
  readonly resolved_violations_count: unknown;
  readonly resolved_safe: unknown;
  readonly resolved_analysis_digest: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F220_FEATURE_ID>;
}

export type F220TransitiveVariableTaintPropagatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F220_FEATURE_ID>;

export const DEFAULT_F220_CONFIG: F220TransitiveVariableTaintPropagatorConfig = {
  featureId: F220_FEATURE_ID,
  stage: F220_STAGE,
  operationCode: F220_OPERATION_CODE,
  contractVersion: F220_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F220TransitiveVariableTaintPropagatorValidationError extends Error {
  public readonly featureId = F220_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F220 Validation Error on '${field}']: ${message}`);
    this.name = "F220TransitiveVariableTaintPropagatorValidationError";
    this.field = field;
  }
}

export function computeF220Digest(rawPayload: string): string {
  return `f220_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F220TransitiveVariableTaintPropagatorService extends KosmoraFeatureAdapterBase<
  typeof F220_FEATURE_ID,
  typeof F220_STAGE,
  typeof F220_OPERATION_CODE,
  F220TransitiveVariableTaintPropagatorConfig,
  F220TransitiveVariableTaintPropagatorInput,
  F220TransitiveVariableTaintPropagatorOutput
> {
  constructor(customConfig?: Partial<F220TransitiveVariableTaintPropagatorConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F220_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["tainted_chain", "violations_count", "safe", "analysis_digest"] as const,
      F220TransitiveVariableTaintPropagatorValidationError
    );
  }
}

export function verifyF220Module(): {
  readonly featureId: typeof F220_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F220TransitiveVariableTaintPropagatorService();
  const sampleInput: F220TransitiveVariableTaintPropagatorInput = {
    requestId: "req_verify_f220",
    projectId: "proj_kosmora_f220",
    workspaceId: "ws_kosmora_f220",
    tenantId: "tenant_rlm_f220",
    actorId: "actor_verifier_f220",
    autonomyLevel: "A3",
    tainted_chain: "seed_f220_tainted_chain",
    violations_count: 42,
    safe: true,
    analysis_digest: "seed_f220_analysis_digest",
    metadata: { stage: "stage7-formal-verification", featureId: "F220" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F220" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tainted_chain !== sampleInput.tainted_chain &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F220] Verification failed`);
  }

  return {
    featureId: F220_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
