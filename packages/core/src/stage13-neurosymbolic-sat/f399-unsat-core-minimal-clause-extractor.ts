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

export const F399_FEATURE_ID = "F399" as const;
export const F399_STAGE = "stage13-neurosymbolic-sat" as const;
export const F399_OPERATION_CODE = "F399_UNSAT_CORE_MINIMAL_CLAUSE_EXTRACTOR" as const;
export const F399_CONTRACT_VERSION = "2.0.0" as const;

export type F399UnsatCoreMinimalClauseExtractorConfig = BaseFeatureConfig<
  typeof F399_FEATURE_ID,
  typeof F399_STAGE,
  typeof F399_OPERATION_CODE
>;

export interface F399UnsatCoreMinimalClauseExtractorInput extends BaseFeatureInput {
  readonly unsat_cnf_clauses: string | number | boolean | readonly string[];
  readonly clause_labels: string | number | boolean | readonly string[];
  readonly deletion_probe_order: string | number | boolean | readonly string[];
  readonly proof_trace_enabled: string | number | boolean | readonly string[];
}

export interface F399UnsatCoreMinimalClauseExtractorOutput {
  readonly featureId: typeof F399_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F399_OPERATION_CODE;
  readonly resolved_unsat_cnf_clauses: unknown;
  readonly resolved_clause_labels: unknown;
  readonly resolved_deletion_probe_order: unknown;
  readonly resolved_proof_trace_enabled: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F399_FEATURE_ID>;
}

export type F399UnsatCoreMinimalClauseExtractorTelemetrySnapshot = BaseFeatureTelemetry<typeof F399_FEATURE_ID>;

export const DEFAULT_F399_CONFIG: F399UnsatCoreMinimalClauseExtractorConfig = {
  featureId: F399_FEATURE_ID,
  stage: F399_STAGE,
  operationCode: F399_OPERATION_CODE,
  contractVersion: F399_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F399UnsatCoreMinimalClauseExtractorValidationError extends Error {
  public readonly featureId = F399_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F399 Validation Error on '${field}']: ${message}`);
    this.name = "F399UnsatCoreMinimalClauseExtractorValidationError";
    this.field = field;
  }
}

export function computeF399Digest(rawPayload: string): string {
  return `f399_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F399UnsatCoreMinimalClauseExtractorService extends KosmoraFeatureAdapterBase<
  typeof F399_FEATURE_ID,
  typeof F399_STAGE,
  typeof F399_OPERATION_CODE,
  F399UnsatCoreMinimalClauseExtractorConfig,
  F399UnsatCoreMinimalClauseExtractorInput,
  F399UnsatCoreMinimalClauseExtractorOutput
> {
  constructor(customConfig?: Partial<F399UnsatCoreMinimalClauseExtractorConfig>, kernel?: Stage13NeurosymbolicSatKernel) {
    super(
      DEFAULT_F399_CONFIG,
      customConfig,
      kernel ?? Stage13NeurosymbolicSatKernel.getShared(),
      ["unsat_cnf_clauses", "clause_labels", "deletion_probe_order", "proof_trace_enabled"] as const,
      F399UnsatCoreMinimalClauseExtractorValidationError
    );
  }
}

export function verifyF399Module(): {
  readonly featureId: typeof F399_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F399UnsatCoreMinimalClauseExtractorService();
  const sampleInput: F399UnsatCoreMinimalClauseExtractorInput = {
    requestId: "req_verify_f399",
    projectId: "proj_kosmora_f399",
    workspaceId: "ws_kosmora_f399",
    tenantId: "tenant_rlm_f399",
    actorId: "actor_verifier_f399",
    autonomyLevel: "A3",
    unsat_cnf_clauses: "seed_f399_unsat_cnf_clauses",
    clause_labels: 42,
    deletion_probe_order: true,
    proof_trace_enabled: "seed_f399_proof_trace_enabled",
    metadata: { stage: "stage13-neurosymbolic-sat", featureId: "F399" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F399" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_unsat_cnf_clauses !== sampleInput.unsat_cnf_clauses &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F399] Verification failed`);
  }

  return {
    featureId: F399_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
