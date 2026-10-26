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

export const F447_FEATURE_ID = "F447" as const;
export const F447_STAGE = "stage14-cybernetic-control" as const;
export const F447_OPERATION_CODE = "F447_VECTOR_LYAPUNOV_DECENTRALIZED_INTERCONNECT" as const;
export const F447_CONTRACT_VERSION = "2.0.0" as const;

export type F447VectorLyapunovDecentralizedInterconnectConfig = BaseFeatureConfig<
  typeof F447_FEATURE_ID,
  typeof F447_STAGE,
  typeof F447_OPERATION_CODE
>;

export interface F447VectorLyapunovDecentralizedInterconnectInput extends BaseFeatureInput {
  readonly subsystem_gains: string | number | boolean | readonly string[];
  readonly interconnection_matrix_m: string | number | boolean | readonly string[];
  readonly metzler_check: string | number | boolean | readonly string[];
  readonly stability_tolerance: string | number | boolean | readonly string[];
}

export interface F447VectorLyapunovDecentralizedInterconnectOutput {
  readonly featureId: typeof F447_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F447_OPERATION_CODE;
  readonly resolved_subsystem_gains: unknown;
  readonly resolved_interconnection_matrix_m: unknown;
  readonly resolved_metzler_check: unknown;
  readonly resolved_stability_tolerance: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F447_FEATURE_ID>;
}

export type F447VectorLyapunovDecentralizedInterconnectTelemetrySnapshot = BaseFeatureTelemetry<typeof F447_FEATURE_ID>;

export const DEFAULT_F447_CONFIG: F447VectorLyapunovDecentralizedInterconnectConfig = {
  featureId: F447_FEATURE_ID,
  stage: F447_STAGE,
  operationCode: F447_OPERATION_CODE,
  contractVersion: F447_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F447VectorLyapunovDecentralizedInterconnectValidationError extends Error {
  public readonly featureId = F447_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F447 Validation Error on '${field}']: ${message}`);
    this.name = "F447VectorLyapunovDecentralizedInterconnectValidationError";
    this.field = field;
  }
}

export function computeF447Digest(rawPayload: string): string {
  return `f447_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F447VectorLyapunovDecentralizedInterconnectService extends KosmoraFeatureAdapterBase<
  typeof F447_FEATURE_ID,
  typeof F447_STAGE,
  typeof F447_OPERATION_CODE,
  F447VectorLyapunovDecentralizedInterconnectConfig,
  F447VectorLyapunovDecentralizedInterconnectInput,
  F447VectorLyapunovDecentralizedInterconnectOutput
> {
  constructor(customConfig?: Partial<F447VectorLyapunovDecentralizedInterconnectConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F447_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["subsystem_gains", "interconnection_matrix_m", "metzler_check", "stability_tolerance"] as const,
      F447VectorLyapunovDecentralizedInterconnectValidationError
    );
  }
}

export function verifyF447Module(): {
  readonly featureId: typeof F447_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F447VectorLyapunovDecentralizedInterconnectService();
  const sampleInput: F447VectorLyapunovDecentralizedInterconnectInput = {
    requestId: "req_verify_f447",
    projectId: "proj_kosmora_f447",
    workspaceId: "ws_kosmora_f447",
    tenantId: "tenant_rlm_f447",
    actorId: "actor_verifier_f447",
    autonomyLevel: "A3",
    subsystem_gains: "seed_f447_subsystem_gains",
    interconnection_matrix_m: 42,
    metzler_check: true,
    stability_tolerance: "seed_f447_stability_tolerance",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F447" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F447" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_subsystem_gains !== sampleInput.subsystem_gains &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F447] Verification failed`);
  }

  return {
    featureId: F447_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
