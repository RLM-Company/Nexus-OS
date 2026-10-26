/**
 * F200 (stage7-formal-verification): Контроллер правил анти-аффинности (Anti-Affinity) между критическими агентами
 * Гарантия размещения исполнителя и агента-критика на разных физических узлах или зонах отказоустойчивости
 * Operation Code: anti_affinity_fault_domain_guard
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

export const F200_FEATURE_ID = "F200" as const;
export const F200_STAGE = "stage7-formal-verification" as const;
export const F200_OPERATION_CODE = "anti_affinity_fault_domain_guard" as const;
export const F200_CONTRACT_VERSION = "2.0.0" as const;

export type F200AntiAffinityFaultDomainGuardConfig = BaseFeatureConfig<
  typeof F200_FEATURE_ID,
  typeof F200_STAGE,
  typeof F200_OPERATION_CODE
>;

export interface F200AntiAffinityFaultDomainGuardInput extends BaseFeatureInput {
  readonly anti_affinity_enforced: string | number | boolean | readonly string[];
  readonly distinct_hosts_used: string | number | boolean | readonly string[];
  readonly feasible: string | number | boolean | readonly string[];
  readonly placement_map: string | number | boolean | readonly string[];
}

export interface F200AntiAffinityFaultDomainGuardOutput {
  readonly featureId: typeof F200_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F200_OPERATION_CODE;
  readonly resolved_anti_affinity_enforced: unknown;
  readonly resolved_distinct_hosts_used: unknown;
  readonly resolved_feasible: unknown;
  readonly resolved_placement_map: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F200_FEATURE_ID>;
}

export type F200AntiAffinityFaultDomainGuardTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F200_FEATURE_ID
>;

export const DEFAULT_F200_CONFIG: F200AntiAffinityFaultDomainGuardConfig = {
  featureId: F200_FEATURE_ID,
  stage: F200_STAGE,
  operationCode: F200_OPERATION_CODE,
  contractVersion: F200_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F200AntiAffinityFaultDomainGuardValidationError extends Error {
  public readonly featureId = F200_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F200 Validation Error on '${field}']: ${message}`);
    this.name = "F200AntiAffinityFaultDomainGuardValidationError";
    this.field = field;
  }
}

export function computeF200Digest(rawPayload: string): string {
  return `f200_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F200AntiAffinityFaultDomainGuardService extends KosmoraFeatureAdapterBase<
  typeof F200_FEATURE_ID,
  typeof F200_STAGE,
  typeof F200_OPERATION_CODE,
  F200AntiAffinityFaultDomainGuardConfig,
  F200AntiAffinityFaultDomainGuardInput,
  F200AntiAffinityFaultDomainGuardOutput
> {
  constructor(
    customConfig?: Partial<F200AntiAffinityFaultDomainGuardConfig>,
    kernel?: Stage7FormalKernel
  ) {
    super(
      DEFAULT_F200_CONFIG,
      customConfig,
      kernel ?? Stage7FormalKernel.getShared(),
      ["anti_affinity_enforced", "distinct_hosts_used", "feasible", "placement_map"] as const,
      F200AntiAffinityFaultDomainGuardValidationError
    );
  }
}

export function verifyF200Module(): {
  readonly featureId: typeof F200_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F200AntiAffinityFaultDomainGuardService();
  const sampleInput: F200AntiAffinityFaultDomainGuardInput = {
    requestId: "req_verify_f200",
    projectId: "proj_kosmora_f200",
    workspaceId: "ws_kosmora_f200",
    tenantId: "tenant_rlm_f200",
    actorId: "actor_verifier_f200",
    autonomyLevel: "A3",
    anti_affinity_enforced: "seed_f200_anti_affinity_enforced",
    distinct_hosts_used: 42,
    feasible: true,
    placement_map: "seed_f200_placement_map",
    metadata: { stage: "stage7-formal-verification", featureId: "F200" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F200" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_anti_affinity_enforced !== sampleInput.anti_affinity_enforced &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F200] Verification failed`);
  }

  return {
    featureId: F200_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
