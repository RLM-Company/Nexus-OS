/**
 * F319 (stage10-game-theory): Компилятор таблицы маршрутизации на базе устойчивого равновесия Гейла-Шепли
 * Преобразование доказанно устойчивого паросочетания в исполняемый план диспетчера воркеров
 * Operation Code: galeshapley_routing_compile
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

export const F319_FEATURE_ID = "F319" as const;
export const F319_STAGE = "stage10-game-theory" as const;
export const F319_OPERATION_CODE = "galeshapley_routing_compile" as const;
export const F319_CONTRACT_VERSION = "2.0.0" as const;

export type F319GaleShapleyDispatchRoutingTableCompilerConfig = BaseFeatureConfig<
  typeof F319_FEATURE_ID,
  typeof F319_STAGE,
  typeof F319_OPERATION_CODE
>;

export interface F319GaleShapleyDispatchRoutingTableCompilerInput extends BaseFeatureInput {
  readonly stable_pair_list: string | number | boolean | readonly string[];
  readonly proposal_count: string | number | boolean | readonly string[];
  readonly stability_verified: string | number | boolean | readonly string[];
  readonly dispatch_epoch: string | number | boolean | readonly string[];
}

export interface F319GaleShapleyDispatchRoutingTableCompilerOutput {
  readonly featureId: typeof F319_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F319_OPERATION_CODE;
  readonly resolved_stable_pair_list: unknown;
  readonly resolved_proposal_count: unknown;
  readonly resolved_stability_verified: unknown;
  readonly resolved_dispatch_epoch: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F319_FEATURE_ID>;
}

export type F319GaleShapleyDispatchRoutingTableCompilerTelemetrySnapshot = BaseFeatureTelemetry<typeof F319_FEATURE_ID>;

export const DEFAULT_F319_CONFIG: F319GaleShapleyDispatchRoutingTableCompilerConfig = {
  featureId: F319_FEATURE_ID,
  stage: F319_STAGE,
  operationCode: F319_OPERATION_CODE,
  contractVersion: F319_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F319GaleShapleyDispatchRoutingTableCompilerValidationError extends Error {
  public readonly featureId = F319_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F319 Validation Error on '${field}']: ${message}`);
    this.name = "F319GaleShapleyDispatchRoutingTableCompilerValidationError";
    this.field = field;
  }
}

export function computeF319Digest(rawPayload: string): string {
  return `f319_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F319GaleShapleyDispatchRoutingTableCompilerService extends KosmoraFeatureAdapterBase<
  typeof F319_FEATURE_ID,
  typeof F319_STAGE,
  typeof F319_OPERATION_CODE,
  F319GaleShapleyDispatchRoutingTableCompilerConfig,
  F319GaleShapleyDispatchRoutingTableCompilerInput,
  F319GaleShapleyDispatchRoutingTableCompilerOutput
> {
  constructor(customConfig?: Partial<F319GaleShapleyDispatchRoutingTableCompilerConfig>, kernel?: Stage10GameTheoryKernel) {
    super(
      DEFAULT_F319_CONFIG,
      customConfig,
      kernel ?? Stage10GameTheoryKernel.getShared(),
      ["stable_pair_list", "proposal_count", "stability_verified", "dispatch_epoch"] as const,
      F319GaleShapleyDispatchRoutingTableCompilerValidationError
    );
  }
}

export function verifyF319Module(): {
  readonly featureId: typeof F319_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F319GaleShapleyDispatchRoutingTableCompilerService();
  const sampleInput: F319GaleShapleyDispatchRoutingTableCompilerInput = {
    requestId: "req_verify_f319",
    projectId: "proj_kosmora_f319",
    workspaceId: "ws_kosmora_f319",
    tenantId: "tenant_rlm_f319",
    actorId: "actor_verifier_f319",
    autonomyLevel: "A3",
    stable_pair_list: "seed_f319_stable_pair_list",
    proposal_count: 42,
    stability_verified: true,
    dispatch_epoch: "seed_f319_dispatch_epoch",
    metadata: { stage: "stage10-game-theory", featureId: "F319" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F319" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_stable_pair_list !== sampleInput.stable_pair_list &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F319] Verification failed`);
  }

  return {
    featureId: F319_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
