/**
 * F154 (stage5-enterprise): Единый вход и корпоративная авторизация (SSO / OAuth2 / JWT)
 * Бесшовный вход через провайдеров идентификации с двухфакторной защитой
 * Operation Code: sso_jwt_verifier
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F154_FEATURE_ID = "F154" as const;
export const F154_STAGE = "stage5-enterprise" as const;
export const F154_OPERATION_CODE = "sso_jwt_verifier" as const;
export const F154_CONTRACT_VERSION = "2.0.0" as const;

export type F154EnterpriseSsoOauth2JwtAuthExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F154EnterpriseSsoOauth2JwtAuthConfig {
  readonly featureId: typeof F154_FEATURE_ID;
  readonly stage: typeof F154_STAGE;
  readonly operationCode: typeof F154_OPERATION_CODE;
  readonly contractVersion: typeof F154_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F154EnterpriseSsoOauth2JwtAuthInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly idp_provider: string;
  readonly subject_claim: string | number;
  readonly mfa_verified: string | number | boolean | readonly string[];
  readonly session_token_issued: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F154EnterpriseSsoOauth2JwtAuthAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F154_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F154EnterpriseSsoOauth2JwtAuthOutput {
  readonly featureId: typeof F154_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F154EnterpriseSsoOauth2JwtAuthExecutionStatus;
  readonly operationCode: typeof F154_OPERATION_CODE;
  readonly resolved_idp_provider: string;
  readonly resolved_subject_claim: string | number;
  readonly resolved_mfa_verified: string | number | boolean | readonly string[];
  readonly resolved_session_token_issued: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F154EnterpriseSsoOauth2JwtAuthAuditEntry;
}

export interface F154EnterpriseSsoOauth2JwtAuthTelemetrySnapshot {
  readonly featureId: typeof F154_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F154_CONFIG: F154EnterpriseSsoOauth2JwtAuthConfig = {
  featureId: F154_FEATURE_ID,
  stage: F154_STAGE,
  operationCode: F154_OPERATION_CODE,
  contractVersion: F154_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F154EnterpriseSsoOauth2JwtAuthValidationError extends Error {
  public readonly featureId = F154_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F154 Validation Error on '${field}']: ${message}`);
    this.name = "F154EnterpriseSsoOauth2JwtAuthValidationError";
    this.field = field;
  }
}

export function computeF154Digest(rawPayload: string): string {
  return `f154_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F154EnterpriseSsoOauth2JwtAuthEngine {
  private readonly config: F154EnterpriseSsoOauth2JwtAuthConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F154EnterpriseSsoOauth2JwtAuthOutput[] = [];
  private readonly auditLog: F154EnterpriseSsoOauth2JwtAuthAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F154EnterpriseSsoOauth2JwtAuthOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F154EnterpriseSsoOauth2JwtAuthConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F154_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F154EnterpriseSsoOauth2JwtAuthConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F154EnterpriseSsoOauth2JwtAuthInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.idp_provider).trim().length === 0) {
      throw new F154EnterpriseSsoOauth2JwtAuthValidationError("idp_provider", "Primary domain attribute 'idp_provider' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      idp_provider: input.idp_provider,
      subject_claim: input.subject_claim,
      mfa_verified: input.mfa_verified,
      session_token_issued: input.session_token_issued
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F154EnterpriseSsoOauth2JwtAuthValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F154EnterpriseSsoOauth2JwtAuthInput): F154EnterpriseSsoOauth2JwtAuthOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F154_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        idp_provider: input.idp_provider,
        subject_claim: input.subject_claim,
        mfa_verified: input.mfa_verified,
        session_token_issued: input.session_token_issued
      });
      const payloadHash = computeF154Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F154EnterpriseSsoOauth2JwtAuthValidationError(
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
        featureId: F154_FEATURE_ID,
        operationCode: F154_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          idp_provider: input.idp_provider,
          subject_claim: input.subject_claim,
          mfa_verified: input.mfa_verified,
          session_token_issued: input.session_token_issued
        }
      });

      const executionId = `exec_f154_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f154_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F154EnterpriseSsoOauth2JwtAuthAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F154_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `sso_jwt_verifier:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F154EnterpriseSsoOauth2JwtAuthOutput = {
        featureId: F154_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F154_OPERATION_CODE,
        resolved_idp_provider: kernelResult.resolvedFields.idp_provider as string,
        resolved_subject_claim: kernelResult.resolvedFields.subject_claim as string | number,
        resolved_mfa_verified: kernelResult.resolvedFields.mfa_verified as string | number | boolean | readonly string[],
        resolved_session_token_issued: kernelResult.resolvedFields.session_token_issued as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F154EnterpriseSsoOauth2JwtAuthTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F154_FEATURE_ID,
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

  public getAuditTrail(): readonly F154EnterpriseSsoOauth2JwtAuthAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F154EnterpriseSsoOauth2JwtAuthOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF154Module(): {
  featureId: typeof F154_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F154EnterpriseSsoOauth2JwtAuthEngine();
  const sampleInput: F154EnterpriseSsoOauth2JwtAuthInput = {
    requestId: "req_verify_f154",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    idp_provider: "f154_idp_provider_seed",
    subject_claim: 42,
    mfa_verified: true,
    session_token_issued: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 154 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F154" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_idp_provider !== sampleInput.idp_provider &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F154_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
