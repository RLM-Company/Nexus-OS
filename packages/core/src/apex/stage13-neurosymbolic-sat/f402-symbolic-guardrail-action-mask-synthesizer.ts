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

export const F402_FEATURE_ID = "F402" as const;
export const F402_STAGE = "stage13-neurosymbolic-sat" as const;
export const F402_OPERATION_CODE = "F402_SYMBOLIC_GUARDRAIL_ACTION_MASK_SYNTHESIZER" as const;
export const F402_CONTRACT_VERSION = "2.0.0" as const;

export type F402SymbolicGuardrailActionMaskSynthesizerConfig = BaseFeatureConfig<
  typeof F402_FEATURE_ID,
  typeof F402_STAGE,
  typeof F402_OPERATION_CODE
>;

export interface F402SymbolicGuardrailActionMaskSynthesizerInput extends BaseFeatureInput {
  readonly candidate_tool_calls: string | number | boolean | readonly string[];
  readonly safety_datalog_rules: string | number | boolean | readonly string[];
  readonly state_predicates: string | number | boolean | readonly string[];
  readonly fallback_action: string | number | boolean | readonly string[];
}

export interface F402SymbolicGuardrailActionMaskSynthesizerOutput {
  readonly featureId: typeof F402_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F402_OPERATION_CODE;
  readonly resolved_candidate_tool_calls: unknown;
  readonly resolved_safety_datalog_rules: unknown;
  readonly resolved_state_predicates: unknown;
  readonly resolved_fallback_action: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F402_FEATURE_ID>;
}

export type F402SymbolicGuardrailActionMaskSynthesizerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F402_FEATURE_ID
>;

export const DEFAULT_F402_CONFIG: F402SymbolicGuardrailActionMaskSynthesizerConfig = {
  featureId: F402_FEATURE_ID,
  stage: F402_STAGE,
  operationCode: F402_OPERATION_CODE,
  contractVersion: F402_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F402SymbolicGuardrailActionMaskSynthesizerValidationError extends Error {
  public readonly featureId = F402_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F402 Validation Error on '${field}']: ${message}`);
    this.name = "F402SymbolicGuardrailActionMaskSynthesizerValidationError";
    this.field = field;
  }
}

export function computeF402Digest(rawPayload: string): string {
  return `f402_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F402SymbolicGuardrailActionMaskSynthesizerService extends KosmoraFeatureAdapterBase<
  typeof F402_FEATURE_ID,
  typeof F402_STAGE,
  typeof F402_OPERATION_CODE,
  F402SymbolicGuardrailActionMaskSynthesizerConfig,
  F402SymbolicGuardrailActionMaskSynthesizerInput,
  F402SymbolicGuardrailActionMaskSynthesizerOutput
> {
  constructor(
    customConfig?: Partial<F402SymbolicGuardrailActionMaskSynthesizerConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F402_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      [
        "candidate_tool_calls",
        "safety_datalog_rules",
        "state_predicates",
        "fallback_action"
      ] as const,
      F402SymbolicGuardrailActionMaskSynthesizerValidationError
    );
  }
}

export function verifyF402Module(): {
  readonly featureId: typeof F402_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F402SymbolicGuardrailActionMaskSynthesizerService();
  const sampleInput: F402SymbolicGuardrailActionMaskSynthesizerInput = {
    requestId: "req_verify_f402",
    projectId: "proj_kosmora_f402",
    workspaceId: "ws_kosmora_f402",
    tenantId: "tenant_rlm_f402",
    actorId: "actor_verifier_f402",
    autonomyLevel: "A3",
    candidate_tool_calls: "seed_f402_candidate_tool_calls",
    safety_datalog_rules: 42,
    state_predicates: true,
    fallback_action: "seed_f402_fallback_action",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F402" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F402" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_candidate_tool_calls !== sampleInput.candidate_tool_calls &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F402] Verification failed`);
  }

  return {
    featureId: F402_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
