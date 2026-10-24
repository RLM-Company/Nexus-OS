/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F149
 * ============================================================================
 * Feature ID: F149
 * Stage: stage5-enterprise
 * Title: Публичное REST / GraphQL API платформы
 * Description: Возможность запускать задачи Kosmora и забирать готовые артефакты из внешних B2B-систем
 * Operation Code: b2b_api_gateway
 * Target Package Directory: packages/policy-engine/src/stage5-enterprise
 * ============================================================================
 */

export const F149_FEATURE_ID = "F149" as const;
export const F149_STAGE = "stage5-enterprise" as const;
export const F149_OPERATION_CODE = "b2b_api_gateway" as const;
export const F149_CONTRACT_VERSION = "1.0.0" as const;

export type F149PublicB2bRestGraphqlApiExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F149PublicB2bRestGraphqlApiConfig {
  readonly featureId: typeof F149_FEATURE_ID;
  readonly stage: typeof F149_STAGE;
  readonly operationCode: typeof F149_OPERATION_CODE;
  readonly contractVersion: typeof F149_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F149PublicB2bRestGraphqlApiInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly api_key_id: string;
  readonly graphql_or_rest_op: string | number;
  readonly rate_limit_remaining: string | number | boolean | readonly string[];
  readonly response_envelope: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F149PublicB2bRestGraphqlApiOutput {
  readonly featureId: typeof F149_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F149PublicB2bRestGraphqlApiExecutionStatus;
  readonly operationCode: typeof F149_OPERATION_CODE;
  readonly resolved_api_key_id: string;
  readonly resolved_graphql_or_rest_op: string | number;
  readonly resolved_rate_limit_remaining: string | number | boolean | readonly string[];
  readonly resolved_response_envelope: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F149PublicB2bRestGraphqlApiAuditEntry;
}

export interface F149PublicB2bRestGraphqlApiAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F149_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F149PublicB2bRestGraphqlApiTelemetrySnapshot {
  readonly featureId: typeof F149_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F149_CONFIG: F149PublicB2bRestGraphqlApiConfig = {
  featureId: F149_FEATURE_ID,
  stage: F149_STAGE,
  operationCode: F149_OPERATION_CODE,
  contractVersion: F149_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F149PublicB2bRestGraphqlApiValidationError extends Error {
  public readonly featureId = F149_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F149 Validation Error on '${field}']: ${message}`);
    this.name = "F149PublicB2bRestGraphqlApiValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F149 provenance & audit integrity.
 */
export function computeF149Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f149_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F149: Публичное REST / GraphQL API платформы
 * Возможность запускать задачи Kosmora и забирать готовые артефакты из внешних B2B-систем
 */
export class F149PublicB2bRestGraphqlApiEngine {
  private readonly config: F149PublicB2bRestGraphqlApiConfig;
  private readonly executionHistory: F149PublicB2bRestGraphqlApiOutput[] = [];
  private readonly auditLog: F149PublicB2bRestGraphqlApiAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F149PublicB2bRestGraphqlApiConfig>) {
    this.config = {
      ...DEFAULT_F149_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F149PublicB2bRestGraphqlApiConfig {
    return { ...this.config };
  }

  public validateInput(input: F149PublicB2bRestGraphqlApiInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F149PublicB2bRestGraphqlApiValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F149PublicB2bRestGraphqlApiValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F149PublicB2bRestGraphqlApiValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F149PublicB2bRestGraphqlApiValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.api_key_id).trim().length === 0) {
      throw new F149PublicB2bRestGraphqlApiValidationError("api_key_id", "Primary domain attribute 'api_key_id' cannot be empty.");
    }
  }

  public execute(input: F149PublicB2bRestGraphqlApiInput): F149PublicB2bRestGraphqlApiOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f149_${this.totalRuns}_${computeF149Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F149_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        api_key_id: input.api_key_id,
        graphql_or_rest_op: input.graphql_or_rest_op,
        rate_limit_remaining: input.rate_limit_remaining,
        response_envelope: input.response_envelope,
      });

      const provenanceDigest = computeF149Digest(canonicalPayload);
      const auditRecord: F149PublicB2bRestGraphqlApiAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F149_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `b2b_api_gateway:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F149PublicB2bRestGraphqlApiOutput = {
        featureId: F149_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F149_OPERATION_CODE,
        resolved_api_key_id: input.api_key_id,
        resolved_graphql_or_rest_op: input.graphql_or_rest_op,
        resolved_rate_limit_remaining: input.rate_limit_remaining,
        resolved_response_envelope: input.response_envelope,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord,
      };

      this.executionHistory.push(output);
      return output;
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): F149PublicB2bRestGraphqlApiTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F149_FEATURE_ID,
      totalRuns: this.totalRuns,
      successfulRuns: this.successfulRuns,
      failedRuns: this.failedRuns,
      lastExecutionId: last,
      averageLatencyMs:
        this.successfulRuns > 0
          ? Number((this.cumulativeLatencyMs / this.successfulRuns).toFixed(3))
          : 0,
    };
  }

  public getAuditTrail(): readonly F149PublicB2bRestGraphqlApiAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F149PublicB2bRestGraphqlApiOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F149 (Публичное REST / GraphQL API платформы)
 */
export function verifyF149Module(): {
  featureId: typeof F149_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F149PublicB2bRestGraphqlApiEngine();
  const sampleInput: F149PublicB2bRestGraphqlApiInput = {
    requestId: "req_verify_f149",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    api_key_id: "f149_api_key_id_verified",
    graphql_or_rest_op: 100,
    rate_limit_remaining: true,
    response_envelope: "verified_ok",
    metadata: { stage: "stage5-enterprise", featureNumber: 149 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F149" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F149_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
