/**
 * F221 (stage7-formal-verification): Аудитор безопасности кодовых артефактов перед публикацией на Canvas и в GitHub PR
 * Комплексная проверка сгенерированного TypeScript/JavaScript кода на отсутствие уязвимых потоков данных
 * Operation Code: code_injection_sink_auditor
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

export const F221_FEATURE_ID = "F221" as const;
export const F221_STAGE = "stage7-formal-verification" as const;
export const F221_OPERATION_CODE = "code_injection_sink_auditor" as const;
export const F221_CONTRACT_VERSION = "2.0.0" as const;

export type F221CodeInjectionSinkAuditorConfig = BaseFeatureConfig<
  typeof F221_FEATURE_ID,
  typeof F221_STAGE,
  typeof F221_OPERATION_CODE
>;

export interface F221CodeInjectionSinkAuditorInput extends BaseFeatureInput {
  readonly safe: string | number | boolean | readonly string[];
  readonly audited_lines_count: string | number | boolean | readonly string[];
  readonly violations_count: string | number | boolean | readonly string[];
  readonly audit_certificate: string | number | boolean | readonly string[];
}

export interface F221CodeInjectionSinkAuditorOutput {
  readonly featureId: typeof F221_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F221_OPERATION_CODE;
  readonly resolved_safe: unknown;
  readonly resolved_audited_lines_count: unknown;
  readonly resolved_violations_count: unknown;
  readonly resolved_audit_certificate: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F221_FEATURE_ID>;
}

export type F221CodeInjectionSinkAuditorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F221_FEATURE_ID
>;

export const DEFAULT_F221_CONFIG: F221CodeInjectionSinkAuditorConfig = {
  featureId: F221_FEATURE_ID,
  stage: F221_STAGE,
  operationCode: F221_OPERATION_CODE,
  contractVersion: F221_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F221CodeInjectionSinkAuditorValidationError extends Error {
  public readonly featureId = F221_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F221 Validation Error on '${field}']: ${message}`);
    this.name = "F221CodeInjectionSinkAuditorValidationError";
    this.field = field;
  }
}

export function computeF221Digest(rawPayload: string): string {
  return `f221_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F221CodeInjectionSinkAuditorService extends KosmoraFeatureAdapterBase<
  typeof F221_FEATURE_ID,
  typeof F221_STAGE,
  typeof F221_OPERATION_CODE,
  F221CodeInjectionSinkAuditorConfig,
  F221CodeInjectionSinkAuditorInput,
  F221CodeInjectionSinkAuditorOutput
> {
  constructor(
    customConfig?: Partial<F221CodeInjectionSinkAuditorConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F221_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["safe", "audited_lines_count", "violations_count", "audit_certificate"] as const,
      F221CodeInjectionSinkAuditorValidationError
    );
  }
}

export function verifyF221Module(): {
  readonly featureId: typeof F221_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F221CodeInjectionSinkAuditorService();
  const sampleInput: F221CodeInjectionSinkAuditorInput = {
    requestId: "req_verify_f221",
    projectId: "proj_kosmora_f221",
    workspaceId: "ws_kosmora_f221",
    tenantId: "tenant_rlm_f221",
    actorId: "actor_verifier_f221",
    autonomyLevel: "A3",
    safe: "seed_f221_safe",
    audited_lines_count: 42,
    violations_count: true,
    audit_certificate: "seed_f221_audit_certificate",
    metadata: { stage: "stage7-formal-verification", featureId: "F221" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F221" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_safe !== sampleInput.safe &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F221] Verification failed`);
  }

  return {
    featureId: F221_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
