/**
 * F150 (stage5-enterprise): Безопасный шаринг артефактов по внешним ссылкам
 * Генерация read-only ссылок на отчёты и презентации с паролем и сроком жизни (TTL)
 * Operation Code: secure_share_link_issuer
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F150_FEATURE_ID = "F150" as const;
export const F150_STAGE = "stage5-enterprise" as const;
export const F150_OPERATION_CODE = "secure_share_link_issuer" as const;
export const F150_CONTRACT_VERSION = "2.0.0" as const;

export type F150ExternalTtlPasswordShareLinksExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F150ExternalTtlPasswordShareLinksConfig {
  readonly featureId: typeof F150_FEATURE_ID;
  readonly stage: typeof F150_STAGE;
  readonly operationCode: typeof F150_OPERATION_CODE;
  readonly contractVersion: typeof F150_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F150ExternalTtlPasswordShareLinksInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly share_token: string;
  readonly artifact_id: string | number;
  readonly expires_at_iso: string | number | boolean | readonly string[];
  readonly password_protected: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F150ExternalTtlPasswordShareLinksAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F150_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F150ExternalTtlPasswordShareLinksOutput {
  readonly featureId: typeof F150_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F150ExternalTtlPasswordShareLinksExecutionStatus;
  readonly operationCode: typeof F150_OPERATION_CODE;
  readonly resolved_share_token: string;
  readonly resolved_artifact_id: string | number;
  readonly resolved_expires_at_iso: string | number | boolean | readonly string[];
  readonly resolved_password_protected: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F150ExternalTtlPasswordShareLinksAuditEntry;
}

export interface F150ExternalTtlPasswordShareLinksTelemetrySnapshot {
  readonly featureId: typeof F150_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F150_CONFIG: F150ExternalTtlPasswordShareLinksConfig = {
  featureId: F150_FEATURE_ID,
  stage: F150_STAGE,
  operationCode: F150_OPERATION_CODE,
  contractVersion: F150_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F150ExternalTtlPasswordShareLinksValidationError extends Error {
  public readonly featureId = F150_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F150 Validation Error on '${field}']: ${message}`);
    this.name = "F150ExternalTtlPasswordShareLinksValidationError";
    this.field = field;
  }
}

export function computeF150Digest(rawPayload: string): string {
  return `f150_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F150ExternalTtlPasswordShareLinksEngine {
  private readonly config: F150ExternalTtlPasswordShareLinksConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F150ExternalTtlPasswordShareLinksOutput[] = [];
  private readonly auditLog: F150ExternalTtlPasswordShareLinksAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F150ExternalTtlPasswordShareLinksOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F150ExternalTtlPasswordShareLinksConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F150_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F150ExternalTtlPasswordShareLinksConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F150ExternalTtlPasswordShareLinksInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.share_token).trim().length === 0) {
      throw new F150ExternalTtlPasswordShareLinksValidationError("share_token", "Primary domain attribute 'share_token' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      share_token: input.share_token,
      artifact_id: input.artifact_id,
      expires_at_iso: input.expires_at_iso,
      password_protected: input.password_protected
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F150ExternalTtlPasswordShareLinksValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F150ExternalTtlPasswordShareLinksInput): F150ExternalTtlPasswordShareLinksOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F150_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        share_token: input.share_token,
        artifact_id: input.artifact_id,
        expires_at_iso: input.expires_at_iso,
        password_protected: input.password_protected
      });
      const payloadHash = computeF150Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F150ExternalTtlPasswordShareLinksValidationError(
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
        featureId: F150_FEATURE_ID,
        operationCode: F150_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          share_token: input.share_token,
          artifact_id: input.artifact_id,
          expires_at_iso: input.expires_at_iso,
          password_protected: input.password_protected
        }
      });

      const executionId = `exec_f150_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f150_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F150ExternalTtlPasswordShareLinksAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F150_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `secure_share_link_issuer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F150ExternalTtlPasswordShareLinksOutput = {
        featureId: F150_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F150_OPERATION_CODE,
        resolved_share_token: kernelResult.resolvedFields.share_token as string,
        resolved_artifact_id: kernelResult.resolvedFields.artifact_id as string | number,
        resolved_expires_at_iso: kernelResult.resolvedFields.expires_at_iso as string | number | boolean | readonly string[],
        resolved_password_protected: kernelResult.resolvedFields.password_protected as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F150ExternalTtlPasswordShareLinksTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F150_FEATURE_ID,
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

  public getAuditTrail(): readonly F150ExternalTtlPasswordShareLinksAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F150ExternalTtlPasswordShareLinksOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF150Module(): {
  featureId: typeof F150_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F150ExternalTtlPasswordShareLinksEngine();
  const sampleInput: F150ExternalTtlPasswordShareLinksInput = {
    requestId: "req_verify_f150",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    share_token: "f150_share_token_seed",
    artifact_id: 42,
    expires_at_iso: true,
    password_protected: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 150 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F150" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_share_token !== sampleInput.share_token &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F150_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
