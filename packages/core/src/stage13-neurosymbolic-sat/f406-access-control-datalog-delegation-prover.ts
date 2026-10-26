import { createHash } from "node:crypto";
import {
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "../stage1-autonomy/stage-kernel.js";
import { Stage13NeurosymbolicSatKernel } from "./stage-kernel.js";

export const F406_FEATURE_ID = "F406" as const;
export const F406_STAGE = "stage13-neurosymbolic-sat" as const;
export const F406_OPERATION_CODE = "F406_ACCESS_CONTROL_DATALOG_DELEGATION_PROVER" as const;
export const F406_CONTRACT_VERSION = "2.0.0" as const;

export type F406AccessControlDatalogDelegationProverConfig = BaseFeatureConfig<
  typeof F406_FEATURE_ID,
  typeof F406_STAGE,
  typeof F406_OPERATION_CODE
>;

export interface F406AccessControlDatalogDelegationProverInput extends BaseFeatureInput {
  readonly delegation_certs: string | number | boolean | readonly string[];
  readonly principal_facts: string | number | boolean | readonly string[];
  readonly requested_resource: string | number | boolean | readonly string[];
  readonly trust_root_set: string | number | boolean | readonly string[];
}

export interface F406AccessControlDatalogDelegationProverOutput {
  readonly featureId: typeof F406_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F406_OPERATION_CODE;
  readonly resolved_delegation_certs: unknown;
  readonly resolved_principal_facts: unknown;
  readonly resolved_requested_resource: unknown;
  readonly resolved_trust_root_set: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F406_FEATURE_ID>;
}

export type F406AccessControlDatalogDelegationProverTelemetrySnapshot = BaseFeatureTelemetry<typeof F406_FEATURE_ID>;

export const DEFAULT_F406_CONFIG: F406AccessControlDatalogDelegationProverConfig = {
  featureId: F406_FEATURE_ID,
  stage: F406_STAGE,
  operationCode: F406_OPERATION_CODE,
  contractVersion: F406_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F406AccessControlDatalogDelegationProverValidationError extends Error {
  public readonly featureId = F406_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F406 Validation Error on '${field}']: ${message}`);
    this.name = "F406AccessControlDatalogDelegationProverValidationError";
    this.field = field;
  }
}

export function computeF406Digest(rawPayload: string): string {
  return `f406_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F406AccessControlDatalogDelegationProverService extends KosmoraFeatureAdapterBase<
  typeof F406_FEATURE_ID,
  typeof F406_STAGE,
  typeof F406_OPERATION_CODE,
  F406AccessControlDatalogDelegationProverConfig,
  F406AccessControlDatalogDelegationProverInput,
  F406AccessControlDatalogDelegationProverOutput
> {
  constructor(customConfig?: Partial<F406AccessControlDatalogDelegationProverConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F406_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["delegation_certs", "principal_facts", "requested_resource", "trust_root_set"] as const,
      F406AccessControlDatalogDelegationProverValidationError
    );
  }
}

export function verifyF406Module(): {
  readonly featureId: typeof F406_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F406AccessControlDatalogDelegationProverService();
  const sampleInput: F406AccessControlDatalogDelegationProverInput = {
    requestId: "req_verify_f406",
    projectId: "proj_kosmora_f406",
    workspaceId: "ws_kosmora_f406",
    tenantId: "tenant_rlm_f406",
    actorId: "actor_verifier_f406",
    autonomyLevel: "A3",
    delegation_certs: "seed_f406_delegation_certs",
    principal_facts: 42,
    requested_resource: true,
    trust_root_set: "seed_f406_trust_root_set",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F406" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F406" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_delegation_certs !== sampleInput.delegation_certs &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F406] Verification failed`);
  }

  return {
    featureId: F406_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
