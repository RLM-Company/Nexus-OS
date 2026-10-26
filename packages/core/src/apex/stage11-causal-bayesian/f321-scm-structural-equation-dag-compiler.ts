/**
 * F321 (stage11-causal-bayesian): Компилятор структурных причинно-следственных моделей (SCM DAG Compiler)
 * Построение топологически упорядоченного графа структурных уравнений X_i = f_i(pa_i, U_i)
 * Operation Code: scm_dag_compiler
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
import { Stage11CausalBayesianKernel } from "./stage-kernel.js";

export const F321_FEATURE_ID = "F321" as const;
export const F321_STAGE = "stage11-causal-bayesian" as const;
export const F321_OPERATION_CODE = "scm_dag_compiler" as const;
export const F321_CONTRACT_VERSION = "2.0.0" as const;

export type F321ScmStructuralEquationDagCompilerConfig = BaseFeatureConfig<
  typeof F321_FEATURE_ID,
  typeof F321_STAGE,
  typeof F321_OPERATION_CODE
>;

export interface F321ScmStructuralEquationDagCompilerInput extends BaseFeatureInput {
  readonly variables_list: string | number | boolean | readonly string[];
  readonly causal_edges: string | number | boolean | readonly string[];
  readonly exogenous_priors: string | number | boolean | readonly string[];
  readonly acyclic_verified: string | number | boolean | readonly string[];
}

export interface F321ScmStructuralEquationDagCompilerOutput {
  readonly featureId: typeof F321_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F321_OPERATION_CODE;
  readonly resolved_variables_list: unknown;
  readonly resolved_causal_edges: unknown;
  readonly resolved_exogenous_priors: unknown;
  readonly resolved_acyclic_verified: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F321_FEATURE_ID>;
}

export type F321ScmStructuralEquationDagCompilerTelemetrySnapshot = BaseFeatureTelemetry<
  typeof F321_FEATURE_ID
>;

export const DEFAULT_F321_CONFIG: F321ScmStructuralEquationDagCompilerConfig = {
  featureId: F321_FEATURE_ID,
  stage: F321_STAGE,
  operationCode: F321_OPERATION_CODE,
  contractVersion: F321_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F321ScmStructuralEquationDagCompilerValidationError extends Error {
  public readonly featureId = F321_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F321 Validation Error on '${field}']: ${message}`);
    this.name = "F321ScmStructuralEquationDagCompilerValidationError";
    this.field = field;
  }
}

export function computeF321Digest(rawPayload: string): string {
  return `f321_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F321ScmStructuralEquationDagCompilerService extends KosmoraFeatureAdapterBase<
  typeof F321_FEATURE_ID,
  typeof F321_STAGE,
  typeof F321_OPERATION_CODE,
  F321ScmStructuralEquationDagCompilerConfig,
  F321ScmStructuralEquationDagCompilerInput,
  F321ScmStructuralEquationDagCompilerOutput
> {
  constructor(
    customConfig?: Partial<F321ScmStructuralEquationDagCompilerConfig>,
    kernel?: Stage11CausalBayesianKernel
  ) {
    super(
      DEFAULT_F321_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["variables_list", "causal_edges", "exogenous_priors", "acyclic_verified"] as const,
      F321ScmStructuralEquationDagCompilerValidationError
    );
  }
}

export function verifyF321Module(): {
  readonly featureId: typeof F321_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F321ScmStructuralEquationDagCompilerService();
  const sampleInput: F321ScmStructuralEquationDagCompilerInput = {
    requestId: "req_verify_f321",
    projectId: "proj_kosmora_f321",
    workspaceId: "ws_kosmora_f321",
    tenantId: "tenant_rlm_f321",
    actorId: "actor_verifier_f321",
    autonomyLevel: "A3",
    variables_list: "seed_f321_variables_list",
    causal_edges: 42,
    exogenous_priors: true,
    acyclic_verified: "seed_f321_acyclic_verified",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F321" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F321" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_variables_list !== sampleInput.variables_list &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F321] Verification failed`);
  }

  return {
    featureId: F321_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
