/**
 * F158 (stage5-enterprise): Шаблоны быстрого онбординга воркспейсов
 * Развёртывание преднастроенного пространства с демо-графом, скиллами и примерами на Canvas за 30 секунд
 * Operation Code: instant_onboarding_seeder
 */

import { createHash } from "node:crypto";
import { Stage5EnterpriseKernel, type StageKernelExecutionResult } from "./stage-kernel.js";

export const F158_FEATURE_ID = "F158" as const;
export const F158_STAGE = "stage5-enterprise" as const;
export const F158_OPERATION_CODE = "instant_onboarding_seeder" as const;
export const F158_CONTRACT_VERSION = "2.0.0" as const;

export type F158FastWorkspaceOnboardingTemplatesExecutionStatus =
  | "idle"
  | "validating"
  | "executing"
  | "completed"
  | "degraded"
  | "cancelled"
  | "failed";

export interface F158FastWorkspaceOnboardingTemplatesConfig {
  readonly featureId: typeof F158_FEATURE_ID;
  readonly stage: typeof F158_STAGE;
  readonly operationCode: typeof F158_OPERATION_CODE;
  readonly contractVersion: typeof F158_CONTRACT_VERSION;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface F158FastWorkspaceOnboardingTemplatesInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly template_name: string;
  readonly seeded_nodes_count: string | number;
  readonly seeded_skills_count: string | number | boolean | readonly string[];
  readonly elapsed_ms: string | number | boolean | Record<string, unknown>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface F158FastWorkspaceOnboardingTemplatesAuditEntry {
  readonly eventId: string;
  readonly featureId: typeof F158_FEATURE_ID;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface F158FastWorkspaceOnboardingTemplatesOutput {
  readonly featureId: typeof F158_FEATURE_ID;
  readonly requestId: string;
  readonly executionId: string;
  readonly status: F158FastWorkspaceOnboardingTemplatesExecutionStatus;
  readonly operationCode: typeof F158_OPERATION_CODE;
  readonly resolved_template_name: string;
  readonly resolved_seeded_nodes_count: string | number;
  readonly resolved_seeded_skills_count: string | number | boolean | readonly string[];
  readonly resolved_elapsed_ms: string | number | boolean | Record<string, unknown>;
  readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
  readonly idempotentReplay: boolean;
  readonly provenanceDigest: string;
  readonly latencyMs: number;
  readonly timestampIso: string;
  readonly auditRecord: F158FastWorkspaceOnboardingTemplatesAuditEntry;
}

export interface F158FastWorkspaceOnboardingTemplatesTelemetrySnapshot {
  readonly featureId: typeof F158_FEATURE_ID;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export const DEFAULT_F158_CONFIG: F158FastWorkspaceOnboardingTemplatesConfig = {
  featureId: F158_FEATURE_ID,
  stage: F158_STAGE,
  operationCode: F158_OPERATION_CODE,
  contractVersion: F158_CONTRACT_VERSION,
  timeoutMs: 15_000,
  maxRetries: 3,
  enableAuditTrail: true,
  enableTelemetry: true,
  strictValidation: true
};

export class F158FastWorkspaceOnboardingTemplatesValidationError extends Error {
  public readonly featureId = F158_FEATURE_ID;
  public readonly field: string;

  constructor(field: string, message: string) {
    super(`[F158 Validation Error on '${field}']: ${message}`);
    this.name = "F158FastWorkspaceOnboardingTemplatesValidationError";
    this.field = field;
  }
}

export function computeF158Digest(rawPayload: string): string {
  return `f158_${createHash("sha256").update(rawPayload).digest("hex").slice(0, 16)}`;
}

export class F158FastWorkspaceOnboardingTemplatesEngine {
  private readonly config: F158FastWorkspaceOnboardingTemplatesConfig;
  private readonly kernel: Stage5EnterpriseKernel;
  private readonly executionHistory: F158FastWorkspaceOnboardingTemplatesOutput[] = [];
  private readonly auditLog: F158FastWorkspaceOnboardingTemplatesAuditEntry[] = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: F158FastWorkspaceOnboardingTemplatesOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  constructor(customConfig?: Partial<F158FastWorkspaceOnboardingTemplatesConfig>, kernel?: Stage5EnterpriseKernel) {
    this.config = {
      ...DEFAULT_F158_CONFIG,
      ...(customConfig ?? {})
    };
    this.kernel = kernel ?? new Stage5EnterpriseKernel();
  }

  public getConfig(): F158FastWorkspaceOnboardingTemplatesConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: F158FastWorkspaceOnboardingTemplatesInput): void {
    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("requestId", "Request ID must be a non-empty string.");
    }
    if (!input.projectId || input.projectId.trim().length === 0) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("projectId", "Project ID must be a non-empty string.");
    }
    if (!input.workspaceId || input.workspaceId.trim().length === 0) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("workspaceId", "Workspace ID must be a non-empty string.");
    }
    if (!input.tenantId || input.tenantId.trim().length === 0) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("tenantId", "Tenant ID must be a non-empty string.");
    }
    if (!input.actorId || input.actorId.trim().length === 0) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("actorId", "Actor ID must be a non-empty string.");
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    if (this.config.strictValidation && String(input.template_name).trim().length === 0) {
      throw new F158FastWorkspaceOnboardingTemplatesValidationError("template_name", "Primary domain attribute 'template_name' cannot be empty.");
    }
    for (const [fieldKey, fieldVal] of Object.entries({
      template_name: input.template_name,
      seeded_nodes_count: input.seeded_nodes_count,
      seeded_skills_count: input.seeded_skills_count,
      elapsed_ms: input.elapsed_ms
    })) {
      if (typeof fieldVal === "number" && (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)) {
        throw new F158FastWorkspaceOnboardingTemplatesValidationError(fieldKey, `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`);
      }
    }
  }

  public execute(input: F158FastWorkspaceOnboardingTemplatesInput): F158FastWorkspaceOnboardingTemplatesOutput {
    const startedMs = Date.now();
    this.totalRuns += 1;

    try {
      this.validateInput(input);

      const canonicalPayload = JSON.stringify({
        featureId: F158_FEATURE_ID,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        template_name: input.template_name,
        seeded_nodes_count: input.seeded_nodes_count,
        seeded_skills_count: input.seeded_skills_count,
        elapsed_ms: input.elapsed_ms
      });
      const payloadHash = computeF158Digest(canonicalPayload);

      const existingIdempotent = this.idempotencyStore.get(input.requestId);
      if (existingIdempotent) {
        if (existingIdempotent.payloadHash !== payloadHash) {
          throw new F158FastWorkspaceOnboardingTemplatesValidationError(
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
        featureId: F158_FEATURE_ID,
        operationCode: F158_OPERATION_CODE,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields: {
          template_name: input.template_name,
          seeded_nodes_count: input.seeded_nodes_count,
          seeded_skills_count: input.seeded_skills_count,
          elapsed_ms: input.elapsed_ms
        }
      });

      const executionId = `exec_f158_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `f158_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: F158FastWorkspaceOnboardingTemplatesAuditEntry = {
        eventId: `aud_${executionId}`,
        featureId: F158_FEATURE_ID,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `instant_onboarding_seeder:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };

      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(1, Date.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output: F158FastWorkspaceOnboardingTemplatesOutput = {
        featureId: F158_FEATURE_ID,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: F158_OPERATION_CODE,
        resolved_template_name: kernelResult.resolvedFields.template_name as string,
        resolved_seeded_nodes_count: kernelResult.resolvedFields.seeded_nodes_count as string | number,
        resolved_seeded_skills_count: kernelResult.resolvedFields.seeded_skills_count as string | number | boolean | readonly string[],
        resolved_elapsed_ms: kernelResult.resolvedFields.elapsed_ms as string | number | boolean | Record<string, unknown>,
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

  public getTelemetrySnapshot(): F158FastWorkspaceOnboardingTemplatesTelemetrySnapshot {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: F158_FEATURE_ID,
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

  public getAuditTrail(): readonly F158FastWorkspaceOnboardingTemplatesAuditEntry[] {
    return [...this.auditLog];
  }

  public getExecutionHistory(): readonly F158FastWorkspaceOnboardingTemplatesOutput[] {
    return [...this.executionHistory];
  }
}

export function verifyF158Module(): {
  featureId: typeof F158_FEATURE_ID;
  passed: boolean;
  executionId: string;
  provenanceDigest: string;
} {
  const engine = new F158FastWorkspaceOnboardingTemplatesEngine();
  const sampleInput: F158FastWorkspaceOnboardingTemplatesInput = {
    requestId: "req_verify_f158",
    projectId: "proj_cosmora_core",
    workspaceId: "ws_kosmora_main",
    tenantId: "tenant_rlm_company",
    actorId: "actor_system_verifier",
    autonomyLevel: "A3",
    template_name: "f158_template_name_seed",
    seeded_nodes_count: 42,
    seeded_skills_count: true,
    elapsed_ms: "verified_seed",
    metadata: { stage: "stage5-enterprise", featureNumber: 158 }
  };

  const result = engine.execute(sampleInput);
  const replay = engine.execute(sampleInput);
  const telemetry = engine.getTelemetrySnapshot();
  const passed =
    result.status === "completed" &&
    result.featureId === "F158" &&
    result.domainOutcome.stateChanged === true &&
    result.resolved_template_name !== sampleInput.template_name &&
    replay.idempotentReplay === true &&
    telemetry.successfulRuns === 2 &&
    engine.getAuditTrail().length === 1;

  return {
    featureId: F158_FEATURE_ID,
    passed,
    executionId: result.executionId,
    provenanceDigest: result.provenanceDigest
  };
}
