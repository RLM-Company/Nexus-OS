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

export const F443_FEATURE_ID = "F443" as const;
export const F443_STAGE = "stage14-cybernetic-control" as const;
export const F443_OPERATION_CODE = "F443_LITTLE_LAW_QUEUING_OCCUPANCY_STABILIZER" as const;
export const F443_CONTRACT_VERSION = "2.0.0" as const;

export type F443LittleLawQueuingOccupancyStabilizerConfig = BaseFeatureConfig<
  typeof F443_FEATURE_ID,
  typeof F443_STAGE,
  typeof F443_OPERATION_CODE
>;

export interface F443LittleLawQueuingOccupancyStabilizerInput extends BaseFeatureInput {
  readonly arrival_rate_lambda: string | number | boolean | readonly string[];
  readonly service_rate_mu: string | number | boolean | readonly string[];
  readonly server_count_c: string | number | boolean | readonly string[];
  readonly target_sojourn_time: string | number | boolean | readonly string[];
}

export interface F443LittleLawQueuingOccupancyStabilizerOutput {
  readonly featureId: typeof F443_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F443_OPERATION_CODE;
  readonly resolved_arrival_rate_lambda: unknown;
  readonly resolved_service_rate_mu: unknown;
  readonly resolved_server_count_c: unknown;
  readonly resolved_target_sojourn_time: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F443_FEATURE_ID>;
}

export type F443LittleLawQueuingOccupancyStabilizerTelemetrySnapshot = BaseFeatureTelemetry<typeof F443_FEATURE_ID>;

export const DEFAULT_F443_CONFIG: F443LittleLawQueuingOccupancyStabilizerConfig = {
  featureId: F443_FEATURE_ID,
  stage: F443_STAGE,
  operationCode: F443_OPERATION_CODE,
  contractVersion: F443_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F443LittleLawQueuingOccupancyStabilizerValidationError extends Error {
  public readonly featureId = F443_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F443 Validation Error on '${field}']: ${message}`);
    this.name = "F443LittleLawQueuingOccupancyStabilizerValidationError";
    this.field = field;
  }
}

export function computeF443Digest(rawPayload: string): string {
  return `f443_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F443LittleLawQueuingOccupancyStabilizerService extends KosmoraFeatureAdapterBase<
  typeof F443_FEATURE_ID,
  typeof F443_STAGE,
  typeof F443_OPERATION_CODE,
  F443LittleLawQueuingOccupancyStabilizerConfig,
  F443LittleLawQueuingOccupancyStabilizerInput,
  F443LittleLawQueuingOccupancyStabilizerOutput
> {
  constructor(customConfig?: Partial<F443LittleLawQueuingOccupancyStabilizerConfig>, kernel?: Stage14CyberneticControlKernel) {
    super(
      DEFAULT_F443_CONFIG,
      customConfig,
      kernel ?? Stage14CyberneticControlKernel.getShared(),
      ["arrival_rate_lambda", "service_rate_mu", "server_count_c", "target_sojourn_time"] as const,
      F443LittleLawQueuingOccupancyStabilizerValidationError
    );
  }
}

export function verifyF443Module(): {
  readonly featureId: typeof F443_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F443LittleLawQueuingOccupancyStabilizerService();
  const sampleInput: F443LittleLawQueuingOccupancyStabilizerInput = {
    requestId: "req_verify_f443",
    projectId: "proj_kosmora_f443",
    workspaceId: "ws_kosmora_f443",
    tenantId: "tenant_rlm_f443",
    actorId: "actor_verifier_f443",
    autonomyLevel: "A3",
    arrival_rate_lambda: "seed_f443_arrival_rate_lambda",
    service_rate_mu: 42,
    server_count_c: true,
    target_sojourn_time: "seed_f443_target_sojourn_time",
    metadata: { stage: "stage14-cybernetic-control", featureId: "F443" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F443" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_arrival_rate_lambda !== sampleInput.arrival_rate_lambda &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F443] Verification failed`);
  }

  return {
    featureId: F443_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
