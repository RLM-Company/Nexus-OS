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

export const F415_FEATURE_ID = "F415" as const;
export const F415_STAGE = "stage13-neurosymbolic-sat" as const;
export const F415_OPERATION_CODE = "F415_PROOF_CARRYING_CODE_CERTIFICATE_CHECKER" as const;
export const F415_CONTRACT_VERSION = "2.0.0" as const;

export type F415ProofCarryingCodeCertificateCheckerConfig = BaseFeatureConfig<
  typeof F415_FEATURE_ID,
  typeof F415_STAGE,
  typeof F415_OPERATION_CODE
>;

export interface F415ProofCarryingCodeCertificateCheckerInput extends BaseFeatureInput {
  readonly resolution_steps: string | number | boolean | readonly string[];
  readonly axiom_clauses: string | number | boolean | readonly string[];
  readonly target_theorem: string | number | boolean | readonly string[];
  readonly hash_chain_seed: string | number | boolean | readonly string[];
}

export interface F415ProofCarryingCodeCertificateCheckerOutput {
  readonly featureId: typeof F415_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F415_OPERATION_CODE;
  readonly resolved_resolution_steps: unknown;
  readonly resolved_axiom_clauses: unknown;
  readonly resolved_target_theorem: unknown;
  readonly resolved_hash_chain_seed: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F415_FEATURE_ID>;
}

export type F415ProofCarryingCodeCertificateCheckerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F415_FEATURE_ID
>;

export const DEFAULT_F415_CONFIG: F415ProofCarryingCodeCertificateCheckerConfig = {
  featureId: F415_FEATURE_ID,
  stage: F415_STAGE,
  operationCode: F415_OPERATION_CODE,
  contractVersion: F415_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F415ProofCarryingCodeCertificateCheckerValidationError extends Error {
  public readonly featureId = F415_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F415 Validation Error on '${field}']: ${message}`);
    this.name = "F415ProofCarryingCodeCertificateCheckerValidationError";
    this.field = field;
  }
}

export function computeF415Digest(rawPayload: string): string {
  return `f415_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F415ProofCarryingCodeCertificateCheckerService extends KosmoraFeatureAdapterBase<
  typeof F415_FEATURE_ID,
  typeof F415_STAGE,
  typeof F415_OPERATION_CODE,
  F415ProofCarryingCodeCertificateCheckerConfig,
  F415ProofCarryingCodeCertificateCheckerInput,
  F415ProofCarryingCodeCertificateCheckerOutput
> {
  constructor(
    customConfig?: Partial<F415ProofCarryingCodeCertificateCheckerConfig>,
    kernel?: Stage13NeurosymbolicSatKernel
  ) {
    super(
      DEFAULT_F415_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["resolution_steps", "axiom_clauses", "target_theorem", "hash_chain_seed"] as const,
      F415ProofCarryingCodeCertificateCheckerValidationError
    );
  }
}

export function verifyF415Module(): {
  readonly featureId: typeof F415_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F415ProofCarryingCodeCertificateCheckerService();
  const sampleInput: F415ProofCarryingCodeCertificateCheckerInput = {
    requestId: "req_verify_f415",
    projectId: "proj_kosmora_f415",
    workspaceId: "ws_kosmora_f415",
    tenantId: "tenant_rlm_f415",
    actorId: "actor_verifier_f415",
    autonomyLevel: "A3",
    resolution_steps: "seed_f415_resolution_steps",
    axiom_clauses: 42,
    target_theorem: true,
    hash_chain_seed: "seed_f415_hash_chain_seed",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F415" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F415" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_resolution_steps !== sampleInput.resolution_steps &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F415] Verification failed`);
  }

  return {
    featureId: F415_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
