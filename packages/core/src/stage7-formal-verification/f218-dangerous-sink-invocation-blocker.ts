/**
 * F218 (stage7-formal-verification): Блокировщик передачи неочищенных данных в опасные стоки (eval, execSync, db.exec)
 * Предотвращение RCE и инъекций кода в сгенерированных агентами скриптах до запуска в песочнице
 * Operation Code: dangerous_sink_invocation_blocker
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

export const F218_FEATURE_ID = "F218" as const;
export const F218_STAGE = "stage7-formal-verification" as const;
export const F218_OPERATION_CODE = "dangerous_sink_invocation_blocker" as const;
export const F218_CONTRACT_VERSION = "2.0.0" as const;

export type F218DangerousSinkInvocationBlockerConfig = BaseFeatureConfig<
  typeof F218_FEATURE_ID,
  typeof F218_STAGE,
  typeof F218_OPERATION_CODE
>;

export interface F218DangerousSinkInvocationBlockerInput extends BaseFeatureInput {
  readonly safe: string | number | boolean | readonly string[];
  readonly blocked_sink_name: string | number | boolean | readonly string[];
  readonly violation_line: string | number | boolean | readonly string[];
  readonly variable_name: string | number | boolean | readonly string[];
}

export interface F218DangerousSinkInvocationBlockerOutput {
  readonly featureId: typeof F218_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F218_OPERATION_CODE;
  readonly resolved_safe: unknown;
  readonly resolved_blocked_sink_name: unknown;
  readonly resolved_violation_line: unknown;
  readonly resolved_variable_name: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F218_FEATURE_ID>;
}

export type F218DangerousSinkInvocationBlockerTelemetrySnapshot = BaseFeatureTelemetry<typeof F218_FEATURE_ID>;

export const DEFAULT_F218_CONFIG: F218DangerousSinkInvocationBlockerConfig = {
  featureId: F218_FEATURE_ID,
  stage: F218_STAGE,
  operationCode: F218_OPERATION_CODE,
  contractVersion: F218_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F218DangerousSinkInvocationBlockerValidationError extends Error {
  public readonly featureId = F218_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F218 Validation Error on '${field}']: ${message}`);
    this.name = "F218DangerousSinkInvocationBlockerValidationError";
    this.field = field;
  }
}

export function computeF218Digest(rawPayload: string): string {
  return `f218_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F218DangerousSinkInvocationBlockerService extends KosmoraFeatureAdapterBase<
  typeof F218_FEATURE_ID,
  typeof F218_STAGE,
  typeof F218_OPERATION_CODE,
  F218DangerousSinkInvocationBlockerConfig,
  F218DangerousSinkInvocationBlockerInput,
  F218DangerousSinkInvocationBlockerOutput
> {
  constructor(customConfig?: Partial<F218DangerousSinkInvocationBlockerConfig>, kernel?: Stage7FormalKernel) {
    super(
      DEFAULT_F218_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["safe", "blocked_sink_name", "violation_line", "variable_name"] as const,
      F218DangerousSinkInvocationBlockerValidationError
    );
  }
}

export function verifyF218Module(): {
  readonly featureId: typeof F218_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F218DangerousSinkInvocationBlockerService();
  const sampleInput: F218DangerousSinkInvocationBlockerInput = {
    requestId: "req_verify_f218",
    projectId: "proj_kosmora_f218",
    workspaceId: "ws_kosmora_f218",
    tenantId: "tenant_rlm_f218",
    actorId: "actor_verifier_f218",
    autonomyLevel: "A3",
    safe: "seed_f218_safe",
    blocked_sink_name: 42,
    violation_line: true,
    variable_name: "seed_f218_variable_name",
    metadata: { stage: "stage7-formal-verification", featureId: "F218" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F218" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_safe !== sampleInput.safe &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F218] Verification failed`);
  }

  return {
    featureId: F218_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
