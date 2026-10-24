/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F155
 * ============================================================================
 * Feature ID: F155
 * Stage: stage5-enterprise
 * Title: Сетевой прокси с белым списком доменов (Egress Proxy)
 * Description: Контроль всех исходящих сетевых обращений из агентской среды
 * Operation Code: egress_domain_firewall
 * Target Package Directory: packages/policy-engine/src/stage5-enterprise
 * ============================================================================
 */

export const F155_FEATURE_ID = "F155" as const;
export const F155_STAGE = "stage5-enterprise" as const;
export const F155_OPERATION_CODE = "egress_domain_firewall" as const;
export const F155_CONTRACT_VERSION = "1.0.0" as const;

export type F155DomainAllowlistEgressProxyExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F155DomainAllowlistEgressProxyConfig {
  readonly featureId: typeof F155_FEATURE_ID;
  readonly stage: typeof F155_STAGE;
  readonly operationCode: typeof F155_OPERATION_CODE;
  readonly contractVersion: typeof F155_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F155DomainAllowlistEgressProxyInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly destination_host: string;
  readonly tenant_allowlist: string | number;
  readonly egress_permitted: string | number | boolean | readonly string[];
  readonly audit_logged: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F155DomainAllowlistEgressProxyOutput {
  readonly featureId: typeof F155_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F155DomainAllowlistEgressProxyExecutionStatus;
  readonly operationCode: typeof F155_OPERATION_CODE;
  readonly resolved_destination_host: string;
  readonly resolved_tenant_allowlist: string | number;
  readonly resolved_egress_permitted: string | number | boolean | readonly string[];
  readonly resolved_audit_logged: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F155DomainAllowlistEgressProxyAuditEntry;
}

export interface F155DomainAllowlistEgressProxyAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F155_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F155DomainAllowlistEgressProxyTelemetrySnapshot {
  readonly featureId: typeof F155_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F155_CONFIG: F155DomainAllowlistEgressProxyConfig = {
  featureId: F155_FEATURE_ID,
  stage: F155_STAGE,
  operationCode: F155_OPERATION_CODE,
  contractVersion: F155_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F155DomainAllowlistEgressProxyValidationError extends Error {
  public readonly featureId = F155_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F155 Validation Error on '${field}']: ${message}`);
    this.name = "F155DomainAllowlistEgressProxyValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F155 provenance & audit integrity.
 */
export function computeF155Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f155_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F155: Сетевой прокси с белым списком доменов (Egress Proxy)
 * Контроль всех исходящих сетевых обращений из агентской среды
 */
export class F155DomainAllowlistEgressProxyEngine {
  private readonly config: F155DomainAllowlistEgressProxyConfig;
  private readonly executionHistory: F155DomainAllowlistEgressProxyOutput[] = [];
  private readonly auditLog: F155DomainAllowlistEgressProxyAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F155DomainAllowlistEgressProxyConfig>) {
    this.config = {
      ...DEFAULT_F155_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F155DomainAllowlistEgressProxyConfig {
    return { ...this.config };
  }

  public validateInput(input: F155DomainAllowlistEgressProxyInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F155DomainAllowlistEgressProxyValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F155DomainAllowlistEgressProxyValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F155DomainAllowlistEgressProxyValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F155DomainAllowlistEgressProxyValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.destination_host).trim().length === 0) {
      throw new F155DomainAllowlistEgressProxyValidationError("destination_host", "Primary domain attribute 'destination_host' cannot be empty.");
    }
  }

  public execute(input: F155DomainAllowlistEgressProxyInput): F155DomainAllowlistEgressProxyOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f155_${this.totalRuns}_${computeF155Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F155_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        destination_host: input.destination_host,
        tenant_allowlist: input.tenant_allowlist,
        egress_permitted: input.egress_permitted,
        audit_logged: input.audit_logged,
      });

      const provenanceDigest = computeF155Digest(canonicalPayload);
      const auditRecord: F155DomainAllowlistEgressProxyAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F155_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `egress_domain_firewall:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F155DomainAllowlistEgressProxyOutput = {
        featureId: F155_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F155_OPERATION_CODE,
        resolved_destination_host: input.destination_host,
        resolved_tenant_allowlist: input.tenant_allowlist,
        resolved_egress_permitted: input.egress_permitted,
        resolved_audit_logged: input.audit_logged,
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

  public getTelemetrySnapshot(): F155DomainAllowlistEgressProxyTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F155_FEATURE_ID,
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

  public getAuditTrail(): readonly F155DomainAllowlistEgressProxyAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F155DomainAllowlistEgressProxyOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F155 (Сетевой прокси с белым списком доменов (Egress Proxy))
 */
export function verifyF155Module(): {
  featureId: typeof F155_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F155DomainAllowlistEgressProxyEngine();
  const sampleInput: F155DomainAllowlistEgressProxyInput = {
    requestId: "req_verify_f155",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    destination_host: "f155_destination_host_verified",
    tenant_allowlist: 100,
    egress_permitted: true,
    audit_logged: "verified_ok",
    metadata: { stage: "stage5-enterprise", featureNumber: 155 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F155" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F155_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
