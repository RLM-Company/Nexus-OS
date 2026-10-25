/**
 * F140 (stage5-enterprise): Поддержка собственных ключей и локальных моделей (BYOK & Local LLM)
 * Возможность подключить корпоративные эндпоинты или локальные модели для закрытого контура
 * Operation Code: byok_endpoint_router
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F140_FEATURE_ID = "F140" as const;
export const F140_STAGE = "stage5-enterprise" as const;
export const F140_OPERATION_CODE = "byok_endpoint_router" as const;
export const F140_CONTRACT_VERSION = "2.0.0" as const;

export type F140ByokLocalLlmConnectorExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F140ByokLocalLlmConnectorConfig {
  readonly featureId: typeof F140_FEATURE_ID;
  readonly stage: typeof F140_STAGE;
  readonly operationCode: typeof F140_OPERATION_CODE;
  readonly contractVersion: typeof F140_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F140ByokLocalLlmConnectorInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly tenant_id: string;
  readonly custom_endpoint_url: string | number;
  readonly airgapped_mode: string | number | boolean | readonly string[];
  readonly handshake_verified: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F140ByokLocalLlmConnectorAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F140_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F140ByokLocalLlmConnectorOutput {
  readonly featureId: typeof F140_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F140ByokLocalLlmConnectorExecutionStatus;
  readonly operationCode: typeof F140_OPERATION_CODE;
  readonly resolved_tenant_id: string;
  readonly resolved_custom_endpoint_url: string | number;
  readonly resolved_airgapped_mode: string | number | boolean | readonly string[];
  readonly resolved_handshake_verified: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F140ByokLocalLlmConnectorAuditEntry;
}

export interface F140ByokLocalLlmConnectorTelemetrySnapshot {
  readonly featureId: typeof F140_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F140_CONFIG: F140ByokLocalLlmConnectorConfig = {
  featureId: F140_FEATURE_ID,
  stage: F140_STAGE,
  operationCode: F140_OPERATION_CODE,
  contractVersion: F140_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F140ByokLocalLlmConnectorValidationError extends Error {
  public readonly featureId = F140_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F140 Validation Error on '${field}']: ${message}`);
    this.name = "F140ByokLocalLlmConnectorValidationError";
    this.field = field;
  }
}

export function computeF140Digest(rawPayload: string): string {
  return `f140_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F140ByokLocalLlmConnectorEngine {
  private readonly config: F140ByokLocalLlmConnectorConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F140ByokLocalLlmConnectorOutput[] = [];
  private readonly auditLog: F140ByokLocalLlmConnectorAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F140ByokLocalLlmConnectorOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F140ByokLocalLlmConnectorConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F140_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F140ByokLocalLlmConnectorConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F140ByokLocalLlmConnectorInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F140ByokLocalLlmConnectorValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F140ByokLocalLlmConnectorValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F140ByokLocalLlmConnectorValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F140ByokLocalLlmConnectorValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F140ByokLocalLlmConnectorValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F140ByokLocalLlmConnectorValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.tenant_id).trim().length === 0) {
      throw new F140ByokLocalLlmConnectorValidationError("tenant_id", "Primary domain attribute 'tenant_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      tenant_id: input.tenant_id,
      custom_endpoint_url: input.custom_endpoint_url,
      airgapped_mode: input.airgapped_mode,
      handshake_verified: input.handshake_verified
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F140ByokLocalLlmConnectorValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F140ByokLocalLlmConnectorInput): F140ByokLocalLlmConnectorOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F140_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        tenant_id: input.tenant_id,
        custom_endpoint_url: input.custom_endpoint_url,
        airgapped_mode: input.airgapped_mode,
        handshake_verified: input.handshake_verified
      });
      const payloadHash = computeF140Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F140ByokLocalLlmConnectorValidationError(
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
        featureId: F140_FEATURE_ID,
        operationCode: F140_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          tenant_id: input.tenant_id,
          custom_endpoint_url: input.custom_endpoint_url,
          airgapped_mode: input.airgapped_mode,
          handshake_verified: input.handshake_verified
        }
      });

      const executionId = `exec_f140_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f140_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F140ByokLocalLlmConnectorAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F140_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `byok_endpoint_router:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F140ByokLocalLlmConnectorOutput = {
        featureId: F140_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F140_OPERATION_CODE,
        resolved_tenant_id: kernelResult.resolvedFields.tenant_id as string,
        resolved_custom_endpoint_url: kernelResult.resolvedFields.custom_endpoint_url as string | number,
        resolved_airgapped_mode: kernelResult.resolvedFields.airgapped_mode as string | number | boolean | readonly string[],
        resolved_handshake_verified: kernelResult.resolvedFields.handshake_verified as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F140ByokLocalLlmConnectorTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F140_FEATURE_ID,
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

  public getAuditTrail(): readonly F140ByokLocalLlmConnectorAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F140ByokLocalLlmConnectorOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF140Module(): {
  featureId: typeof F140_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F140ByokLocalLlmConnectorEngine();
  const sampleInput: F140ByokLocalLlmConnectorInput = {
    requestId: "req_verify_f140",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    tenant_id: "f140_tenant_id_seed",
    custom_endpoint_url: 42,
    airgapped_mode: true,
    handshake_verified: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 140 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F140" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_tenant_id !== sampleInput.tenant_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F140_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
