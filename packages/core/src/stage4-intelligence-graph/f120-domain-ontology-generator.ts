/**
 * F120 (stage4-intelligence-graph): Генерация онтологии под домен
 * Настройка типов узлов и связей под конкретную нишу (разработка ПО, автосервис, маркетинг, аналитика)
 * Operation Code: ontology_schema_builder
 */

import { createHash } from "node:crypto";
import {
  Stage4GraphKernel,
  KosmoraFeatureAdapterBase,
  type BaseFeatureAuditEntry,
  type BaseFeatureConfig,
  type BaseFeatureInput,
  type BaseFeatureTelemetry,
  type StageKernelExecutionResult
} from "./stage-kernel.js";

export const F120_FEATURE_ID = "F120" as const;
export const F120_STAGE = "stage4-intelligence-graph" as const;
export const F120_OPERATION_CODE = "ontology_schema_builder" as const;
export const F120_CONTRACT_VERSION = "2.0.0" as const;

export type F120DomainOntologyGeneratorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export type F120DomainOntologyGeneratorConfig = BaseFeatureConfig<
  typeof F120_FEATURE_ID,
  typeof F120_STAGE,
  typeof F120_OPERATION_CODE
>;

export interface F120DomainOntologyGeneratorInput extends BaseFeatureInput {
  readonly domain_niche: string;
  readonly entity_types: string | number;
  readonly relation_types: string | number | boolean | readonly string[];
  readonly validation_rules: string | number | boolean | Record<string, unknown>;
}

export type F120DomainOntologyGeneratorAuditEntry = BaseFeatureAuditEntry<typeof F120_FEATURE_ID>;

export interface F120DomainOntologyGeneratorOutput {
  readonly featureId: typeof F120_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F120DomainOntologyGeneratorExecutionStatus;
  readonly operationCode: typeof F120_OPERATION_CODE;
  readonly resolved_domain_niche: string;
  readonly resolved_entity_types: string | number;
  readonly resolved_relation_types: string | number | boolean | readonly string[];
  readonly resolved_validation_rules: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F120DomainOntologyGeneratorAuditEntry;
}

export type F120DomainOntologyGeneratorTelemetrySnapshot = BaseFeatureTelemetry<typeof F120_FEATURE_ID>;

export const DEFAULT_F120_CONFIG: F120DomainOntologyGeneratorConfig = {
  featureId: F120_FEATURE_ID,
  stage: F120_STAGE,
  operationCode: F120_OPERATION_CODE,
  contractVersion: F120_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F120DomainOntologyGeneratorValidationError extends Error {
  public readonly featureId = F120_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F120 Validation Error on '${field}']: ${message}`);
    this.name = "F120DomainOntologyGeneratorValidationError";
    this.field = field;
  }
}

export function computeF120Digest(rawPayload: string): string {
  return `f120_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F120DomainOntologyGeneratorEngine extends KosmoraFeatureAdapterBase<
  typeof F120_FEATURE_ID,
  typeof F120_STAGE,
  typeof F120_OPERATION_CODE,
  F120DomainOntologyGeneratorConfig,
  F120DomainOntologyGeneratorInput,
  F120DomainOntologyGeneratorOutput
> {
  constructor(customConfig?: Partial<F120DomainOntologyGeneratorConfig>, kernel?: Stage4GraphKernel) {
    super(
      DEFAULT_F120_CONFIG,
      customConfig,
      kernel ?? new Stage4GraphKernel(),
      ["domain_niche", "entity_types", "relation_types", "validation_rules"] as const,
      F120DomainOntologyGeneratorValidationError
    );
  }
}

export function verifyF120Module(): {
  featureId: typeof F120_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F120DomainOntologyGeneratorEngine();
  const sampleInput: F120DomainOntologyGeneratorInput = {
    requestId: "req_verify_f120",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    domain_niche: "f120_domain_niche_seed",
    entity_types: 42,
    relation_types: true,
    validation_rules: "verified_seed",
    metadata: { stage: "stage4-intelligence-graph", featureNumber: 120 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F120" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_domain_niche !== sampleInput.domain_niche &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F120_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
