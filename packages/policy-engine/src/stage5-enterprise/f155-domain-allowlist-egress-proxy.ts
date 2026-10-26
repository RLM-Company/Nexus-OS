/**
 * F155 (stage5-enterprise): Сетевой прокси с белым списком доменов (Egress Proxy)
 * Контроль всех исходящих сетевых обращений из агентской среды
 * Operation Code: egress_domain_firewall
 */

import { createHash } from "node:crypto";
import {
  Stage5EnterpriseKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F155_FEATURE_ID = "F155" as const;
export const F155_STAGE = "stage5-enterprise" as const;
export const F155_OPERATION_CODE = "egress_domain_firewall" as const;
export const F155_CONTRACT_VERSION = "2.0.0" as const;

export type F155DomainAllowlistEgressProxyExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F155DomainAllowlistEgressProxyConfig = BaseFeatureConfig<
  typeof F155_FEATURE_ID,
  typeof F155_STAGE,
  typeof F155_OPERATION_CODE
>;

export interface F155DomainAllowlistEgressProxyInput extends BaseFeatureInput {
  readonly destination_host: string;
  readonly tenant_allowlist: string | number;
  readonly egress_permitted: string | number | boolean | readonly string[];
  readonly audit_logged: string | number | boolean | Record<string, unknown>;
}

export type F155DomainAllowlistEgressProxyAuditEntry = BaseFeatureAuditEntry<typeof F155_FEATURE_ID>;

export interface F155DomainAllowlistEgressProxyOutput {
  readonly featureId: typeof F155_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F155DomainAllowlistEgressProxyExecutionStatus;
  readonly operationCode: typeof F155_OPERATION_CODE;
  readonly resolved_destination_host: string;
  readonly resolved_tenant_allowlist: string | number;
  readonly resolved_egress_permitted: string | number | boolean | readonly string[];
  readonly resolved_audit_logged: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F155DomainAllowlistEgressProxyAuditEntry;
}

export type F155DomainAllowlistEgressProxyTelemetrySnapshot = BaseFeatureTelemetry<typeof F155_FEATURE_ID>;

export const DEFAULT_F155_CONFIG: F155DomainAllowlistEgressProxyConfig = {
  featureId: F155_FEATURE_ID,
  stage: F155_STAGE,
  operationCode: F155_OPERATION_CODE,
  contractVersion: F155_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F155DomainAllowlistEgressProxyValidationError extends Error {
  public readonly featureId = F155_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F155 Validation Error on '${field}']: ${message}`);
    this.name = "F155DomainAllowlistEgressProxyValidationError";
    this.field = field;
  }
}

export function computeF155Digest(rawPayload: string): string {
  return `f155_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F155DomainAllowlistEgressProxyEngine extends KosmoraFeatureAdapterBase<
  typeof F155_FEATURE_ID,
  typeof F155_STAGE,
  typeof F155_OPERATION_CODE,
  F155DomainAllowlistEgressProxyConfig,
  F155DomainAllowlistEgressProxyInput,
  F155DomainAllowlistEgressProxyOutput
> {
  constructor(customConfig?: Partial<F155DomainAllowlistEgressProxyConfig>, kernel?: Stage5EnterpriseKernel) {
    super(
      DEFAULT_F155_CONFIG,
      customConfig,
      kernel ?? new Stage5EnterpriseKernel(),
      ["destination_host", "tenant_allowlist", "egress_permitted", "audit_logged"] as const,
      F155DomainAllowlistEgressProxyValidationError
    );
  }
}

export function verifyF155Module(): {
  featureId: typeof F155_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F155DomainAllowlistEgressProxyEngine();
  const sampleInput: F155DomainAllowlistEgressProxyInput = {
    requestId: "req_verify_f155",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    destination_host: "f155_destination_host_seed",
    tenant_allowlist: 42,
    egress_permitted: true,
    audit_logged: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 155 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F155" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_destination_host !== sampleInput.destination_host &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F155_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
