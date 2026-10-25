/**
 * F151 (stage5-enterprise): White-Label кастомизация воркспейсов
 * Настройка логотипа, цветовой палитры и домена для клиентских витрин
 * Operation Code: whitelabel_theme_registry
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F151_FEATURE_ID = "F151" as const;
export const F151_STAGE = "stage5-enterprise" as const;
export const F151_OPERATION_CODE = "whitelabel_theme_registry" as const;
export const F151_CONTRACT_VERSION = "2.0.0" as const;

export type F151WhitelabelWorkspaceCustomizerExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F151WhitelabelWorkspaceCustomizerConfig {
  readonly featureId: typeof F151_FEATURE_ID;
  readonly stage: typeof F151_STAGE;
  readonly operationCode: typeof F151_OPERATION_CODE;
  readonly contractVersion: typeof F151_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F151WhitelabelWorkspaceCustomizerInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly tenant_id: string;
  readonly custom_domain: string | number;
  readonly brand_palette: string | number | boolean | readonly string[];
  readonly custom_logo_svg: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F151WhitelabelWorkspaceCustomizerAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F151_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F151WhitelabelWorkspaceCustomizerOutput {
  readonly featureId: typeof F151_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F151WhitelabelWorkspaceCustomizerExecutionStatus;
  readonly operationCode: typeof F151_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_custom_domain: string | number;
  readonly resolved_brand_palette: string | number | boolean | readonly string[];
  readonly resolved_custom_logo_svg: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F151WhitelabelWorkspaceCustomizerAuditEntry;
}

export interface F151WhitelabelWorkspaceCustomizerTelemetrySnapshot {
  readonly featureId: typeof F151_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F151_CONFIG: F151WhitelabelWorkspaceCustomizerConfig = {
  featureId: F151_FEATURE_ID,
  stage: F151_STAGE,
  operationCode: F151_OPERATION_CODE,
  contractVersion: F151_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F151WhitelabelWorkspaceCustomizerValidationError extends Error {
  public readonly featureId = F151_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F151 Validation Error on '${field}']: ${message}`);
    this.name = "F151WhitelabelWorkspaceCustomizerValidationError";
    this.field = field;
  }
}

export function computeF151Digest(rawPayload: string): string {
  return `f151_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F151WhitelabelWorkspaceCustomizerEngine {
  private readonly config: F151WhitelabelWorkspaceCustomizerConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F151WhitelabelWorkspaceCustomizerOutput[] = [];
  private readonly auditLog: F151WhitelabelWorkspaceCustomizerAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F151WhitelabelWorkspaceCustomizerOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F151WhitelabelWorkspaceCustomizerConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F151_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F151WhitelabelWorkspaceCustomizerConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F151WhitelabelWorkspaceCustomizerInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.tenant_id).trim().length === 0) {
      throw new F151WhitelabelWorkspaceCustomizerValidationError("tenant_id", "Primary domain attribute 'tenant_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      tenant_id: input.tenant_id,
      custom_domain: input.custom_domain,
      brand_palette: input.brand_palette,
      custom_logo_svg: input.custom_logo_svg
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F151WhitelabelWorkspaceCustomizerValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F151WhitelabelWorkspaceCustomizerInput): F151WhitelabelWorkspaceCustomizerOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F151_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        tenant_id: input.tenant_id,
        custom_domain: input.custom_domain,
        brand_palette: input.brand_palette,
        custom_logo_svg: input.custom_logo_svg
      });
      const payloadHash = computeF151Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F151WhitelabelWorkspaceCustomizerValidationError(
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
        featureId: F151_FEATURE_ID,
        operationCode: F151_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          tenant_id: input.tenant_id,
          custom_domain: input.custom_domain,
          brand_palette: input.brand_palette,
          custom_logo_svg: input.custom_logo_svg
        }
      });

      const executionId = `exec_f151_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f151_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F151WhitelabelWorkspaceCustomizerAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F151_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `whitelabel_theme_registry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F151WhitelabelWorkspaceCustomizerOutput = {
        featureId: F151_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F151_OPERATION_CODE,
        resolved_tenant_id: kernelResult.resolvedFields.tenant_id as string,
        resolved_custom_domain: kernelResult.resolvedFields.custom_domain as string | number,
        resolved_brand_palette: kernelResult.resolvedFields.brand_palette as string | number | boolean | readonly string[],
        resolved_custom_logo_svg: kernelResult.resolvedFields.custom_logo_svg as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F151WhitelabelWorkspaceCustomizerTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F151_FEATURE_ID,
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

  public getAuditTrail(): readonly F151WhitelabelWorkspaceCustomizerAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F151WhitelabelWorkspaceCustomizerOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF151Module(): {
  featureId: typeof F151_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F151WhitelabelWorkspaceCustomizerEngine();
  const sampleInput: F151WhitelabelWorkspaceCustomizerInput = {
    requestId: "req_verify_f151",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f151_tenant_id_seed",
    custom_domain: 42,
    brand_palette: true,
    custom_logo_svg: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 151 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F151" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F151_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
