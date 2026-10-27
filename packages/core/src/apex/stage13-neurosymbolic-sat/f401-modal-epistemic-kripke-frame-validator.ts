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

export const F401_FEATURE_ID = "F401" as const;
export const F401_STAGE = "stage13-neurosymbolic-sat" as const;
export const F401_OPERATION_CODE = "F401_MODAL_EPISTEMIC_KRIPKE_FRAME_VALIDATOR" as const;
export const F401_CONTRACT_VERSION = "2.0.0" as const;

export type F401ModalEpistemicKripkeFrameValidatorConfig = BaseFeatureConfig<
  typeof F401_FEATURE_ID,
  typeof F401_STAGE,
  typeof F401_OPERATION_CODE
>;

export interface F401ModalEpistemicKripkeFrameValidatorInput extends BaseFeatureInput {
  readonly kripke_worlds: string | number | boolean | readonly string[];
  readonly accessibility_edges: string | number | boolean | readonly string[];
  readonly valuation_map: string | number | boolean | readonly string[];
  readonly modal_formula: string | number | boolean | readonly string[];
}

export interface F401ModalEpistemicKripkeFrameValidatorOutput {
  readonly featureId: typeof F401_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F401_OPERATION_CODE;
  readonly resolved_kripke_worlds: unknown;
  readonly resolved_accessibility_edges: unknown;
  readonly resolved_valuation_map: unknown;
  readonly resolved_modal_formula: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F401_FEATURE_ID>;
}

export type F401ModalEpistemicKripkeFrameValidatorTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F401_FEATURE_ID
>;

export const DEFAULT_F401_CONFIG: F401ModalEpistemicKripkeFrameValidatorConfig = {
  featureId: F401_FEATURE_ID,
  stage: F401_STAGE,
  operationCode: F401_OPERATION_CODE,
  contractVersion: F401_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F401ModalEpistemicKripkeFrameValidatorValidationError extends Error {
  public readonly featureId = F401_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F401 Validation Error on '${field}']: ${message}`);
    this.name = "F401ModalEpistemicKripkeFrameValidatorValidationError";
    this.field = field;
  }
}

export function computeF401Digest(rawPayload: string): string {
  return `f401_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F401ModalEpistemicKripkeFrameValidatorService extends KosmoraFeatureAdapterBase<
  typeof F401_FEATURE_ID,
  typeof F401_STAGE,
  typeof F401_OPERATION_CODE,
  F401ModalEpistemicKripkeFrameValidatorConfig,
  F401ModalEpistemicKripkeFrameValidatorInput,
  F401ModalEpistemicKripkeFrameValidatorOutput
> {
  constructor(
    customConfig?: Partial<F401ModalEpistemicKripkeFrameValidatorConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F401_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["kripke_worlds", "accessibility_edges", "valuation_map", "modal_formula"] as const,
      F401ModalEpistemicKripkeFrameValidatorValidationError
    );
  }
}

export function verifyF401Module(): {
  readonly featureId: typeof F401_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F401ModalEpistemicKripkeFrameValidatorService();
  const sampleInput: F401ModalEpistemicKripkeFrameValidatorInput = {
    requestId: "req_verify_f401",
    projectId: "proj_kosmora_f401",
    workspaceId: "ws_kosmora_f401",
    tenantId: "tenant_rlm_f401",
    actorId: "actor_verifier_f401",
    autonomyLevel: "A3",
    kripke_worlds: "seed_f401_kripke_worlds",
    accessibility_edges: 42,
    valuation_map: true,
    modal_formula: "seed_f401_modal_formula",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F401" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F401" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_kripke_worlds !== sampleInput.kripke_worlds &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F401] Verification failed`);
  }

  return {
    featureId: F401_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
