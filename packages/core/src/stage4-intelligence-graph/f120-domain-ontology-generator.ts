/**
 * F120 (stage4-intelligence-graph): Генерация онтологии под домен
 * Настройка типов узлов и связей под конкретную нишу (разработка ПО, автосервис, маркетинг, аналитика)
 * Operation Code: ontology_schema_builder
 */

import { createHash } from "node:crypto";
import { Stage4GraphKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

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

export interface F120DomainOntologyGeneratorConfig {
  readonly featureId: typeof F120_FEATURE_ID;
  readonly stage: typeof F120_STAGE;
  readonly operationCode: typeof F120_OPERATION_CODE;
  readonly contractVersion: typeof F120_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F120DomainOntologyGeneratorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly domain_niche: string;
  readonly entity_types: string | number;
  readonly relation_types: string | number | boolean | readonly string[];
  readonly validation_rules: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F120DomainOntologyGeneratorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F120_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

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

export interface F120DomainOntologyGeneratorTelemetrySnapshot {
  readonly featureId: typeof F120_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

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

export class F120DomainOntologyGeneratorEngine {
  private readonly config: F120DomainOntologyGeneratorConfig;
  private readonly kernel: Stage4GraphKernel;
  private readonly executionHistory: F120DomainOntologyGeneratorOutput[] = [];
  private readonly auditLog: F120DomainOntologyGeneratorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F120DomainOntologyGeneratorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F120DomainOntologyGeneratorConfig>, kernel?: Stage4GraphKernel) {
    this.config = {
      ...DEFAULT_F120_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage4GraphKernel();
  }

  public getConfig(): F120DomainOntologyGeneratorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F120DomainOntologyGeneratorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F120DomainOntologyGeneratorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F120DomainOntologyGeneratorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F120DomainOntologyGeneratorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F120DomainOntologyGeneratorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F120DomainOntologyGeneratorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F120DomainOntologyGeneratorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.domain_niche).trim().length === 0) {
      throw new F120DomainOntologyGeneratorValidationError("domain_niche", "Primary domain attribute 'domain_niche' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      domain_niche: input.domain_niche,
      entity_types: input.entity_types,
      relation_types: input.relation_types,
      validation_rules: input.validation_rules
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F120DomainOntologyGeneratorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F120DomainOntologyGeneratorInput): F120DomainOntologyGeneratorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F120_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domain_niche: input.domain_niche,
        entity_types: input.entity_types,
        relation_types: input.relation_types,
        validation_rules: input.validation_rules
      });
      const payloadHash = computeF120Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F120DomainOntologyGeneratorValidationError(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return {
          ...existingIdempotent.output,
          idempotentReplay: true
        };
      }

      const kernelResult = this.kernel.executeDomainOperation({
        featureId: F120_FEATURE_ID,
        operationCode: F120_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          domain_niche: input.domain_niche,
          entity_types: input.entity_types,
          relation_types: input.relation_types,
          validation_rules: input.validation_rules
        }
      });

      const executionId = `exec_f120_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f120_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F120DomainOntologyGeneratorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F120_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `ontology_schema_builder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F120DomainOntologyGeneratorOutput = {
        featureId: F120_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F120_OPERATION_CODE,
        resolved_domain_niche: kernelResult.resolvedFields.domain_niche as string,
        resolved_entity_types: kernelResult.resolvedFields.entity_types as string | number,
        resolved_relation_types: kernelResult.resolvedFields.relation_types as string | number | boolean | readonly string[],
        resolved_validation_rules: kernelResult.resolvedFields.validation_rules as string | number | boolean | Record<string, unknown>,
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      };

      this.idempotencyStore.set(input.requestId, { payloadHash, output });
      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F120DomainOntologyGeneratorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F120_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0
    };
  }

  public getAuditTrail(): readonly F120DomainOntologyGeneratorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F120DomainOntologyGeneratorOutput[] {
    return [...this.executionHistory];
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
