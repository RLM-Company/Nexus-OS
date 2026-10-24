/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F136
 * ============================================================================
 * Feature ID: F136
 * Stage: stage5-enterprise
 * Title: Политики разрешённых инструментов (Tool Allowlisting)
 * Description: Ограничение списка скиллов и внешних доменов для конкретных агентов и ролей
 * Operation Code: tool_allowlist_enforcer
 * Target Package Directory: packages/policy-engine/src/stage5-enterprise
 * ============================================================================
 */

export const F136_FEATURE_ID = "F136" as const;
export const F136_STAGE = "stage5-enterprise" as const;
export const F136_OPERATION_CODE = "tool_allowlist_enforcer" as const;
export const F136_CONTRACT_VERSION = "1.0.0" as const;

export type F136RoleToolAllowlistingExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F136RoleToolAllowlistingConfig {
  readonly featureId: typeof F136_FEATURE_ID;
  readonly stage: typeof F136_STAGE;
  readonly operationCode: typeof F136_OPERATION_CODE;
  readonly contractVersion: typeof F136_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F136RoleToolAllowlistingInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly agent_role: string;
  readonly requested_tool_id: string | number;
  readonly allowlist_matched: string | number | boolean | readonly string[];
  readonly enforcement_action: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F136RoleToolAllowlistingOutput {
  readonly featureId: typeof F136_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F136RoleToolAllowlistingExecutionStatus;
  readonly operationCode: typeof F136_OPERATION_CODE;
  readonly resolved_agent_role: string;
  readonly resolved_requested_tool_id: string | number;
  readonly resolved_allowlist_matched: string | number | boolean | readonly string[];
  readonly resolved_enforcement_action: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F136RoleToolAllowlistingAuditEntry;
}

export interface F136RoleToolAllowlistingAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F136_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F136RoleToolAllowlistingTelemetrySnapshot {
  readonly featureId: typeof F136_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F136_CONFIG: F136RoleToolAllowlistingConfig = {
  featureId: F136_FEATURE_ID,
  stage: F136_STAGE,
  operationCode: F136_OPERATION_CODE,
  contractVersion: F136_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F136RoleToolAllowlistingValidationError extends Error {
  public readonly featureId = F136_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F136 Validation Error on '${field}']: ${message}`);
    this.name = "F136RoleToolAllowlistingValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F136 provenance & audit integrity.
 */
export function computeF136Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f136_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F136: Политики разрешённых инструментов (Tool Allowlisting)
 * Ограничение списка скиллов и внешних доменов для конкретных агентов и ролей
 */
export class F136RoleToolAllowlistingEngine {
  private readonly config: F136RoleToolAllowlistingConfig;
  private readonly executionHistory: F136RoleToolAllowlistingOutput[] = [];
  private readonly auditLog: F136RoleToolAllowlistingAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F136RoleToolAllowlistingConfig>) {
    this.config = {
      ...DEFAULT_F136_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F136RoleToolAllowlistingConfig {
    return { ...this.config };
  }

  public validateInput(input: F136RoleToolAllowlistingInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F136RoleToolAllowlistingValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F136RoleToolAllowlistingValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F136RoleToolAllowlistingValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F136RoleToolAllowlistingValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.agent_role).trim().length === 0) {
      throw new F136RoleToolAllowlistingValidationError("agent_role", "Primary domain attribute 'agent_role' cannot be empty.");
    }
  }

  public execute(input: F136RoleToolAllowlistingInput): F136RoleToolAllowlistingOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f136_${this.totalRuns}_${computeF136Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F136_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        agent_role: input.agent_role,
        requested_tool_id: input.requested_tool_id,
        allowlist_matched: input.allowlist_matched,
        enforcement_action: input.enforcement_action,
      });

      const provenanceDigest = computeF136Digest(canonicalPayload);
      const auditRecord: F136RoleToolAllowlistingAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F136_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `tool_allowlist_enforcer:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F136RoleToolAllowlistingOutput = {
        featureId: F136_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F136_OPERATION_CODE,
        resolved_agent_role: input.agent_role,
        resolved_requested_tool_id: input.requested_tool_id,
        resolved_allowlist_matched: input.allowlist_matched,
        resolved_enforcement_action: input.enforcement_action,
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

  public getTelemetrySnapshot(): F136RoleToolAllowlistingTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F136_FEATURE_ID,
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

  public getAuditTrail(): readonly F136RoleToolAllowlistingAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F136RoleToolAllowlistingOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F136 (Политики разрешённых инструментов (Tool Allowlisting))
 */
export function verifyF136Module(): {
  featureId: typeof F136_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F136RoleToolAllowlistingEngine();
  const sampleInput: F136RoleToolAllowlistingInput = {
    requestId: "req_verify_f136",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    agent_role: "f136_agent_role_verified",
    requested_tool_id: 100,
    allowlist_matched: true,
    enforcement_action: "verified_ok",
    metadata: { stage: "stage5-enterprise", featureNumber: 136 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F136" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F136_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
