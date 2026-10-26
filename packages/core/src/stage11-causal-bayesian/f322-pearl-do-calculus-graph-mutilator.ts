/**
 * F322 (stage11-causal-bayesian): Оператор хирургии графа do(X = x) по исчислению Перла (Graph Mutilation Engine)
 * Удаление входящих рёбер в переменную воздействия X для отделения истинной причинности от корреляции
 * Operation Code: pearl_do_mutilator
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

export const F322_FEATURE_ID = "F322" as const;
export const F322_STAGE = "stage11-causal-bayesian" as const;
export const F322_OPERATION_CODE = "pearl_do_mutilator" as const;
export const F322_CONTRACT_VERSION = "2.0.0" as const;

export type F322PearlDoCalculusGraphMutilatorConfig = BaseFeatureConfig<
  typeof F322_FEATURE_ID,
  typeof F322_STAGE,
  typeof F322_OPERATION_CODE
>;

export interface F322PearlDoCalculusGraphMutilatorInput extends BaseFeatureInput {
  readonly target_variable: string | number | boolean | readonly string[];
  readonly intervention_value: string | number | boolean | readonly string[];
  readonly severed_parent_edges: string | number | boolean | readonly string[];
  readonly mutilated_dag_hash: string | number | boolean | readonly string[];
}

export interface F322PearlDoCalculusGraphMutilatorOutput {
  readonly featureId: typeof F322_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: "completed" | "degraded" | "cancelled" | "failed";
  readonly operationCode: typeof F322_OPERATION_CODE;
  readonly resolved_target_variable: unknown;
  readonly resolved_intervention_value: unknown;
  readonly resolved_severed_parent_edges: unknown;
  readonly resolved_mutilated_dag_hash: unknown;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: BaseFeatureAuditEntry<typeof F322_FEATURE_ID>;
}

export type F322PearlDoCalculusGraphMutilatorTelemetrySnapshot = BaseFeatureTelemetry<typeof F322_FEATURE_ID>;

export const DEFAULT_F322_CONFIG: F322PearlDoCalculusGraphMutilatorConfig = {
  featureId: F322_FEATURE_ID,
  stage: F322_STAGE,
  operationCode: F322_OPERATION_CODE,
  contractVersion: F322_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F322PearlDoCalculusGraphMutilatorValidationError extends Error {
  public readonly featureId = F322_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F322 Validation Error on '${field}']: ${message}`);
    this.name = "F322PearlDoCalculusGraphMutilatorValidationError";
    this.field = field;
  }
}

export function computeF322Digest(rawPayload: string): string {
  return `f322_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F322PearlDoCalculusGraphMutilatorService extends KosmoraFeatureAdapterBase<
  typeof F322_FEATURE_ID,
  typeof F322_STAGE,
  typeof F322_OPERATION_CODE,
  F322PearlDoCalculusGraphMutilatorConfig,
  F322PearlDoCalculusGraphMutilatorInput,
  F322PearlDoCalculusGraphMutilatorOutput
> {
  constructor(customConfig?: Partial<F322PearlDoCalculusGraphMutilatorConfig>, kernel?: Stage11CausalBayesianKernel) {
    super(
      DEFAULT_F322_CONFIG,
      customConfig,
      kernel ?? Stage11CausalBayesianKernel.getShared(),
      ["target_variable", "intervention_value", "severed_parent_edges", "mutilated_dag_hash"] as const,
      F322PearlDoCalculusGraphMutilatorValidationError
    );
  }
}

export function verifyF322Module(): {
  readonly featureId: typeof F322_FEATURE_ID;
  readonly verified: boolean;
  readonly passed: boolean;
  readonly executionId: string;
  readonly provenanceDigest: string;
} {
  const svc = new F322PearlDoCalculusGraphMutilatorService();
  const sampleInput: F322PearlDoCalculusGraphMutilatorInput = {
    requestId: "req_verify_f322",
    projectId: "proj_kosmora_f322",
    workspaceId: "ws_kosmora_f322",
    tenantId: "tenant_rlm_f322",
    actorId: "actor_verifier_f322",
    autonomyLevel: "A3",
    target_variable: "seed_f322_target_variable",
    intervention_value: 42,
    severed_parent_edges: true,
    mutilated_dag_hash: "seed_f322_mutilated_dag_hash",
    metadata: { stage: "stage11-causal-bayesian", featureId: "F322" }
  };

  const result = svc.execute(sampleInput);
  const replay = svc.execute(sampleInput);
  const passed =
    result.status === "completed" &&
    result.featureId === "F322" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_target_variable !== sampleInput.target_variable &&
    replay.idempotentReplay === true &&
    svc.getAuditTrail().length === 1;

  if (!passed) {
    throw new Error(`[F322] Verification failed`);
  }

  return {
    featureId: F322_FEATURE_ID,
    verified: passed,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
