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

export const F411_FEATURE_ID = "F411" as const;
export const F411_STAGE = "stage13-neurosymbolic-sat" as const;
export const F411_OPERATION_CODE = "F411_SYMBOLIC_PLAN_CAUSAL_LINK_THREAT_RESOLVER" as const;
export const F411_CONTRACT_VERSION = "2.0.0" as const;

export type F411SymbolicPlanCausalLinkThreatResolverConfig = BaseFeatureConfig<
  typeof F411_FEATURE_ID,
  typeof F411_STAGE,
  typeof F411_OPERATION_CODE
>;

export interface F411SymbolicPlanCausalLinkThreatResolverInput extends BaseFeatureInput {
  readonly partial_order_steps: string | number | boolean | readonly string[];
  readonly causal_links: string | number | boolean | readonly string[];
  readonly ordering_constraints: string | number | boolean | readonly string[];
  readonly threat_promotion_policy: string | number | boolean | readonly string[];
}

export interface F411SymbolicPlanCausalLinkThreatResolverOutput {
  readonly featureId: typeof F411_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F411_OPERATION_CODE;
  readonly resolved_partial_order_steps: unknown;
  readonly resolved_causal_links: unknown;
  readonly resolved_ordering_constraints: unknown;
  readonly resolved_threat_promotion_policy: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F411_FEATURE_ID>;
}

export type F411SymbolicPlanCausalLinkThreatResolverTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F411_FEATURE_ID
>;

export const DEFAULT_F411_CONFIG: F411SymbolicPlanCausalLinkThreatResolverConfig = {
  featureId: F411_FEATURE_ID,
  stage: F411_STAGE,
  operationCode: F411_OPERATION_CODE,
  contractVersion: F411_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F411SymbolicPlanCausalLinkThreatResolverValidationError extends Error {
  public readonly featureId = F411_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F411 Validation Error on '${field}']: ${message}`);
    this.name = "F411SymbolicPlanCausalLinkThreatResolverValidationError";
    this.field = field;
  }
}

export function computeF411Digest(rawPayload: string): string {
  return `f411_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F411SymbolicPlanCausalLinkThreatResolverService extends KosmoraFeatureAdapterBase<
  typeof F411_FEATURE_ID,
  typeof F411_STAGE,
  typeof F411_OPERATION_CODE,
  F411SymbolicPlanCausalLinkThreatResolverConfig,
  F411SymbolicPlanCausalLinkThreatResolverInput,
  F411SymbolicPlanCausalLinkThreatResolverOutput
> {
  constructor(
    customConfig?: Partial<F411SymbolicPlanCausalLinkThreatResolverConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F411_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      [
        "partial_order_steps",
        "causal_links",
        "ordering_constraints",
        "threat_promotion_policy"
      ] as const,
      F411SymbolicPlanCausalLinkThreatResolverValidationError
    );
  }
}

export function verifyF411Module(): {
  readonly featureId: typeof F411_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F411SymbolicPlanCausalLinkThreatResolverService();
  const sampleInput: F411SymbolicPlanCausalLinkThreatResolverInput = {
    requestId: "req_verify_f411",
    projectId: "proj_kosmora_f411",
    workspaceId: "ws_kosmora_f411",
    tenantId: "tenant_rlm_f411",
    actorId: "actor_verifier_f411",
    autonomyLevel: "A3",
    partial_order_steps: "seed_f411_partial_order_steps",
    causal_links: 42,
    ordering_constraints: true,
    threat_promotion_policy: "seed_f411_threat_promotion_policy",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F411" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F411" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_partial_order_steps !== sampleInput.partial_order_steps &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F411] Verification failed`);
  }

  return {
    featureId: F411_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
