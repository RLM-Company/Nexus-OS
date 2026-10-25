/**
 * F160 (stage5-enterprise): Экспорт полного дампа проекта (Full Tenant Portability)
 * Выгрузка всех артефактов, истории чатов, графа знаний и скиллов в самодостаточный архив
 * Operation Code: tenant_portability_dumper
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F160_FEATURE_ID = "F160" as const;
export const F160_STAGE = "stage5-enterprise" as const;
export const F160_OPERATION_CODE = "tenant_portability_dumper" as const;
export const F160_CONTRACT_VERSION = "2.0.0" as const;

export type F160FullTenantPortabilityExporterExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F160FullTenantPortabilityExporterConfig {
  readonly featureId: typeof F160_FEATURE_ID;
  readonly stage: typeof F160_STAGE;
  readonly operationCode: typeof F160_OPERATION_CODE;
  readonly contractVersion: typeof F160_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F160FullTenantPortabilityExporterInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly export_bundle_id: string;
  readonly tenant_id: string | number;
  readonly manifest_integrity_hash: string | number | boolean | readonly string[];
  readonly self_contained_ready: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F160FullTenantPortabilityExporterAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F160_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F160FullTenantPortabilityExporterOutput {
  readonly featureId: typeof F160_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F160FullTenantPortabilityExporterExecutionStatus;
  readonly operationCode: typeof F160_OPERATION_CODE;
  readonly resolved_export_bundle_id: string;
  readonly resolved_tenant_id: string | number;
  readonly resolved_manifest_integrity_hash: string | number | boolean | readonly string[];
  readonly resolved_self_contained_ready: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F160FullTenantPortabilityExporterAuditEntry;
}

export interface F160FullTenantPortabilityExporterTelemetrySnapshot {
  readonly featureId: typeof F160_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F160_CONFIG: F160FullTenantPortabilityExporterConfig = {
  featureId: F160_FEATURE_ID,
  stage: F160_STAGE,
  operationCode: F160_OPERATION_CODE,
  contractVersion: F160_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F160FullTenantPortabilityExporterValidationError extends Error {
  public readonly featureId = F160_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F160 Validation Error on '${field}']: ${message}`);
    this.name = "F160FullTenantPortabilityExporterValidationError";
    this.field = field;
  }
}

export function computeF160Digest(rawPayload: string): string {
  return `f160_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F160FullTenantPortabilityExporterEngine {
  private readonly config: F160FullTenantPortabilityExporterConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F160FullTenantPortabilityExporterOutput[] = [];
  private readonly auditLog: F160FullTenantPortabilityExporterAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F160FullTenantPortabilityExporterOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F160FullTenantPortabilityExporterConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F160_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F160FullTenantPortabilityExporterConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F160FullTenantPortabilityExporterInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F160FullTenantPortabilityExporterValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F160FullTenantPortabilityExporterValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F160FullTenantPortabilityExporterValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F160FullTenantPortabilityExporterValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F160FullTenantPortabilityExporterValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F160FullTenantPortabilityExporterValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.export_bundle_id).trim().length === 0) {
      throw new F160FullTenantPortabilityExporterValidationError("export_bundle_id", "Primary domain attribute 'export_bundle_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      export_bundle_id: input.export_bundle_id,
      tenant_id: input.tenant_id,
      manifest_integrity_hash: input.manifest_integrity_hash,
      self_contained_ready: input.self_contained_ready
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F160FullTenantPortabilityExporterValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F160FullTenantPortabilityExporterInput): F160FullTenantPortabilityExporterOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F160_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        export_bundle_id: input.export_bundle_id,
        tenant_id: input.tenant_id,
        manifest_integrity_hash: input.manifest_integrity_hash,
        self_contained_ready: input.self_contained_ready
      });
      const payloadHash = computeF160Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F160FullTenantPortabilityExporterValidationError(
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
        featureId: F160_FEATURE_ID,
        operationCode: F160_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          export_bundle_id: input.export_bundle_id,
          tenant_id: input.tenant_id,
          manifest_integrity_hash: input.manifest_integrity_hash,
          self_contained_ready: input.self_contained_ready
        }
      });

      const executionId = `exec_f160_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f160_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F160FullTenantPortabilityExporterAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F160_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tenant_portability_dumper:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F160FullTenantPortabilityExporterOutput = {
        featureId: F160_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F160_OPERATION_CODE,
        resolved_export_bundle_id: kernelResult.resolvedFields.export_bundle_id as string,
        resolved_tenant_id: kernelResult.resolvedFields.tenant_id as string | number,
        resolved_manifest_integrity_hash: kernelResult.resolvedFields.manifest_integrity_hash as string | number | boolean | readonly string[],
        resolved_self_contained_ready: kernelResult.resolvedFields.self_contained_ready as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F160FullTenantPortabilityExporterTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F160_FEATURE_ID,
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

  public getAuditTrail(): readonly F160FullTenantPortabilityExporterAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F160FullTenantPortabilityExporterOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF160Module(): {
  featureId: typeof F160_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F160FullTenantPortabilityExporterEngine();
  const sampleInput: F160FullTenantPortabilityExporterInput = {
    requestId: "req_verify_f160",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    export_bundle_id: "f160_export_bundle_id_seed",
    tenant_id: 42,
    manifest_integrity_hash: true,
    self_contained_ready: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 160 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F160" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_export_bundle_id !== sampleInput.export_bundle_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F160_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
