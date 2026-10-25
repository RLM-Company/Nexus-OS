/**
 * F026 (stage1-autonomy): Шаблоны мультиагентных команд (Squad Presets)
 * Преднастроенные связки агентов (Аналитик + Кодер + QA, Ресерчер + Копирайтер + Дизайнер)
 * Operation Code: squad_template
 */

import { createHash } from "node:crypto";
import { Stage1AutonomyKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F026_FEATURE_ID = "F026" as const;
export const F026_STAGE = "stage1-autonomy" as const;
export const F026_OPERATION_CODE = "squad_template" as const;
export const F026_CONTRACT_VERSION = "2.0.0" as const;

export type F026MultiagentSquadPresetsExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F026MultiagentSquadPresetsConfig {
  readonly featureId: typeof F026_FEATURE_ID;
  readonly stage: typeof F026_STAGE;
  readonly operationCode: typeof F026_OPERATION_CODE;
  readonly contractVersion: typeof F026_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F026MultiagentSquadPresetsInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly preset_id: string;
  readonly squad_name: string | number;
  readonly roster_roles: string | number | boolean | readonly string[];
  readonly default_strictness: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F026MultiagentSquadPresetsAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F026_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F026MultiagentSquadPresetsOutput {
  readonly featureId: typeof F026_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F026MultiagentSquadPresetsExecutionStatus;
  readonly operationCode: typeof F026_OPERATION_CODE;
  readonly resolved_preset_id: string;
  readonly resolved_squad_name: string | number;
  readonly resolved_roster_roles: string | number | boolean | readonly string[];
  readonly resolved_default_strictness: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F026MultiagentSquadPresetsAuditEntry;
}

export interface F026MultiagentSquadPresetsTelemetrySnapshot {
  readonly featureId: typeof F026_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F026_CONFIG: F026MultiagentSquadPresetsConfig = {
  featureId: F026_FEATURE_ID,
  stage: F026_STAGE,
  operationCode: F026_OPERATION_CODE,
  contractVersion: F026_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F026MultiagentSquadPresetsValidationError extends Error {
  public readonly featureId = F026_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F026 Validation Error on '${field}']: ${message}`);
    this.name = "F026MultiagentSquadPresetsValidationError";
    this.field = field;
  }
}

export function computeF026Digest(rawPayload: string): string {
  return `f026_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F026MultiagentSquadPresetsEngine {
  private readonly config: F026MultiagentSquadPresetsConfig;
  private readonly kernel: Stage1AutonomyKernel;
  private readonly executionHistory: F026MultiagentSquadPresetsOutput[] = [];
  private readonly auditLog: F026MultiagentSquadPresetsAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F026MultiagentSquadPresetsOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F026MultiagentSquadPresetsConfig>, kernel?: Stage1AutonomyKernel) {
    this.config = {
      ...DEFAULT_F026_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage1AutonomyKernel();
  }

  public getConfig(): F026MultiagentSquadPresetsConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F026MultiagentSquadPresetsInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F026MultiagentSquadPresetsValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F026MultiagentSquadPresetsValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F026MultiagentSquadPresetsValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F026MultiagentSquadPresetsValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F026MultiagentSquadPresetsValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F026MultiagentSquadPresetsValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.preset_id).trim().length === 0) {
      throw new F026MultiagentSquadPresetsValidationError("preset_id", "Primary domain attribute 'preset_id' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      preset_id: input.preset_id,
      squad_name: input.squad_name,
      roster_roles: input.roster_roles,
      default_strictness: input.default_strictness
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F026MultiagentSquadPresetsValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F026MultiagentSquadPresetsInput): F026MultiagentSquadPresetsOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F026_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        preset_id: input.preset_id,
        squad_name: input.squad_name,
        roster_roles: input.roster_roles,
        default_strictness: input.default_strictness
      });
      const payloadHash = computeF026Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F026MultiagentSquadPresetsValidationError(
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
        featureId: F026_FEATURE_ID,
        operationCode: F026_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          preset_id: input.preset_id,
          squad_name: input.squad_name,
          roster_roles: input.roster_roles,
          default_strictness: input.default_strictness
        }
      });

      const executionId = `exec_f026_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f026_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F026MultiagentSquadPresetsAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F026_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `squad_template:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F026MultiagentSquadPresetsOutput = {
        featureId: F026_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F026_OPERATION_CODE,
        resolved_preset_id: kernelResult.resolvedFields.preset_id as string,
        resolved_squad_name: kernelResult.resolvedFields.squad_name as string | number,
        resolved_roster_roles: kernelResult.resolvedFields.roster_roles as string | number | boolean | readonly string[],
        resolved_default_strictness: kernelResult.resolvedFields.default_strictness as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F026MultiagentSquadPresetsTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F026_FEATURE_ID,
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

  public getAuditTrail(): readonly F026MultiagentSquadPresetsAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F026MultiagentSquadPresetsOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF026Module(): {
  featureId: typeof F026_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F026MultiagentSquadPresetsEngine();
  const sampleInput: F026MultiagentSquadPresetsInput = {
    requestId: "req_verify_f026",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    preset_id: "f026_preset_id_seed",
    squad_name: 42,
    roster_roles: true,
    default_strictness: "verified_seed",
    metadata: { stage: "stage1-autonomy", featureNumber: 26 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F026" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_preset_id !== sampleInput.preset_id &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F026_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
