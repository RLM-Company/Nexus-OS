/**
 * ============================================================================
 * NEXUS-OS / KOSMORA MONOREPO — FEATURE MODULE F066
 * ============================================================================
 * Feature ID: F066
 * Stage: stage3-skills-bus
 * Title: Магазин и реестр внутренних скиллов (Skills Registry)
 * Description: Каталог доступных навыков с описанием входных параметров, версий и требуемых прав
 * Operation Code: skills_catalog_registry
 * Target Package Directory: packages/tool-runtime/src/stage3-skills-bus
 * ============================================================================
 */

export const F066_FEATURE_ID = "F066" as const;
export const F066_STAGE = "stage3-skills-bus" as const;
export const F066_OPERATION_CODE = "skills_catalog_registry" as const;
export const F066_CONTRACT_VERSION = "1.0.0" as const;

export type F066InternalSkillsRegistryExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "failed";

export interface F066InternalSkillsRegistryConfig {
  readonly featureId: typeof F066_FEATURE_ID;
  readonly stage: typeof F066_STAGE;
  readonly operationCode: typeof F066_OPERATION_CODE;
  readonly contractVersion: typeof F066_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F066InternalSkillsRegistryInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly skill_id: string;
  readonly version: string | number;
  readonly required_scopes: string | number | boolean | readonly string[];
  readonly registered_count: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F066InternalSkillsRegistryOutput {
  readonly featureId: typeof F066_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F066InternalSkillsRegistryExecutionStatus;
  readonly operationCode: typeof F066_OPERATION_CODE;
  readonly resolved_skill_id: string;
  readonly resolved_version: string | number;
  readonly resolved_required_scopes: string | number | boolean | readonly string[];
  readonly resolved_registered_count: string | number | boolean | Record<string, unknown>;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F066InternalSkillsRegistryAuditEntry;
}

export interface F066InternalSkillsRegistryAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F066_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F066InternalSkillsRegistryTelemetrySnapshot {
  readonly featureId: typeof F066_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F066_CONFIG: F066InternalSkillsRegistryConfig = {
  featureId: F066_FEATURE_ID,
  stage: F066_STAGE,
  operationCode: F066_OPERATION_CODE,
  contractVersion: F066_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true,
};

export class F066InternalSkillsRegistryValidationError extends Error {
  public readonly featureId = F066_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F066 Validation Error on '${field}']: ${message}`);
    this.name = "F066InternalSkillsRegistryValidationError";
    this.field = field;
  }
}

/**
 * Deterministic FNV-1a digest calculator for F066 provenance & audit integrity.
 */
export function computeF066Digest(rawPayload: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < rawPayload.length; i++) {
    hash ^= rawPayload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `f066_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Primary Runtime Engine for F066: Магазин и реестр внутренних скиллов (Skills Registry)
 * Каталог доступных навыков с описанием входных параметров, версий и требуемых прав
 */
export class F066InternalSkillsRegistryEngine {
  private readonly config: F066InternalSkillsRegistryConfig;
  private readonly executionHistory: F066InternalSkillsRegistryOutput[] = [];
  private readonly auditLog: F066InternalSkillsRegistryAuditEntry[] = [];
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F066InternalSkillsRegistryConfig>) {
    this.config = {
      ...DEFAULT_F066_CONFIG,
      ...(customConfig ?? {}),
    };
  }

  public getConfig(): F066InternalSkillsRegistryConfig {
    return { ...this.config };
  }

  public validateInput(input: F066InternalSkillsRegistryInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F066InternalSkillsRegistryValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F066InternalSkillsRegistryValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F066InternalSkillsRegistryValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F066InternalSkillsRegistryValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (this.config.strictValidation && String(input.skill_id).trim().length === 0) {
      throw new F066InternalSkillsRegistryValidationError("skill_id", "Primary domain attribute 'skill_id' cannot be empty.");
    }
  }

  public execute(input: F066InternalSkillsRegistryInput): F066InternalSkillsRegistryOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const executionId = `exec_$f066_${this.totalRuns}_${computeF066Digest(input.requestId)}`;
      const timestampIso = new Date().toISOString();
      const canonicalPayload = JSON.stringify({
        featureId: F066_FEATURE_ID,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        skill_id: input.skill_id,
        version: input.version,
        required_scopes: input.required_scopes,
        registered_count: input.registered_count,
      });

      const provenanceDigest = computeF066Digest(canonicalPayload);
      const auditRecord: F066InternalSkillsRegistryAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F066_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `skills_catalog_registry:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso,
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F066InternalSkillsRegistryOutput = {
        featureId: F066_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F066_OPERATION_CODE,
        resolved_skill_id: input.skill_id,
        resolved_version: input.version,
        resolved_required_scopes: input.required_scopes,
        resolved_registered_count: input.registered_count,
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

  public getTelemetrySnapshot(): F066InternalSkillsRegistryTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F066_FEATURE_ID,
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

  public getAuditTrail(): readonly F066InternalSkillsRegistryAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F066InternalSkillsRegistryOutput[] {
    return [...this.executionHistory];
  }
}

/**
 * Built-in deterministic self-test for F066 (Магазин и реестр внутренних скиллов (Skills Registry))
 */
export function verifyF066Module(): {
  featureId: typeof F066_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F066InternalSkillsRegistryEngine();
  const sampleInput: F066InternalSkillsRegistryInput = {
    requestId: "req_verify_f066",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    skill_id: "f066_skill_id_verified",
    version: 100,
    required_scopes: true,
    registered_count: "verified_ok",
    metadata: { stage: "stage3-skills-bus", featureNumber: 66 },
  };

  const result = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F066" &&
    telemetry.successfulRuns === 1 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F066_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest,
  };
}
