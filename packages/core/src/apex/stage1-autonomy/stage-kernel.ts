import { createHash } from "node:crypto";
import { BoundApexKernel, type BoundApexOperation } from "../bound-kernel.js";
export interface StageKernelExecutionInput {
  featureId: string;
  operationCode: string;
  requestId: string;
  projectId: string;
  workspaceId: string;
  tenantId: string;
  actorId: string;
  autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  domainFields: Record<string, unknown>;
}

export interface StageKernelExecutionResult {
  resolvedFields: Record<string, unknown>;
  domainOutcome: {
    engine: string;
    operationCode: string;
    stateChanged: boolean;
    summary: string;
    metrics: Record<string, number | string | boolean>;
  };
  provenanceSha256: string;
}

export interface BaseFeatureInput {
  readonly requestId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly actorId: string;
  readonly autonomyLevel: "A0" | "A1" | "A2" | "A3" | "A4" | "A5" | "A6";
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface BaseFeatureConfig<TId extends string, TStage extends string, TOp extends string> {
  readonly featureId: TId;
  readonly stage: TStage;
  readonly operationCode: TOp;
  readonly contractVersion: "2.0.0";
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly enableAuditTrail: boolean;
  readonly enableTelemetry: boolean;
  readonly strictValidation: boolean;
}

export interface BaseFeatureAuditEntry<TId extends string> {
  readonly eventId: string;
  readonly featureId: TId;
  readonly tenantId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly action: string;
  readonly payloadHash: string;
  readonly recordedAt: string;
}

export interface BaseFeatureTelemetry<TId extends string> {
  readonly featureId: TId;
  readonly totalRuns: number;
  readonly successfulRuns: number;
  readonly failedRuns: number;
  readonly lastExecutionId: string | null;
  readonly averageLatencyMs: number;
}

export interface StageKernelProvider {
  executeDomainOperation(input: StageKernelExecutionInput): StageKernelExecutionResult;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export abstract class KosmoraFeatureAdapterBase<
  TId extends string,
  TStage extends string,
  TOp extends string,
  TConfig extends BaseFeatureConfig<TId, TStage, TOp>,
  TInput extends BaseFeatureInput,
  TOutput extends {
    readonly featureId: TId;
    readonly requestId: string;
    readonly executionId: string;
    readonly status: string;
    readonly operationCode: TOp;
    readonly domainOutcome: StageKernelExecutionResult["domainOutcome"];
    readonly idempotentReplay: boolean;
    readonly provenanceDigest: string;
    readonly latencyMs: number;
    readonly timestampIso: string;
    readonly auditRecord: BaseFeatureAuditEntry<TId>;
  }
> {
  protected readonly config: TConfig;
  protected readonly kernel: StageKernelProvider;
  private readonly domainFieldNames: readonly [string, string, string, string];
  private readonly errorCtor: new (field: string, message: string) => Error;
  private readonly executionHistory: TOutput[] = [];
  private readonly auditLog: Array<BaseFeatureAuditEntry<TId>> = [];
  private readonly idempotencyStore = new Map<string, { payloadHash: string; output: TOutput }>();
  private readonly cancelledRequests = new Set<string>();
  private totalRuns = 0;
  private successfulRuns = 0;
  private failedRuns = 0;
  private cumulativeLatencyMs = 0;

  protected constructor(
    defaultConfig: TConfig,
    customConfig: Partial<TConfig> | undefined,
    kernel: StageKernelProvider,
    domainFieldNames: readonly [string, string, string, string],
    errorCtor: new (field: string, message: string) => Error
  ) {
    this.config = { ...defaultConfig, ...(customConfig ?? {}) };
    this.kernel = kernel;
    this.domainFieldNames = domainFieldNames;
    this.errorCtor = errorCtor;
  }

  public getConfig(): TConfig {
    return { ...this.config };
  }

  public cancelRequest(requestId: string): void {
    this.cancelledRequests.add(requestId);
  }

  public validateInput(input: TInput): void {
    for (const requiredKey of [
      "requestId",
      "projectId",
      "workspaceId",
      "tenantId",
      "actorId"
    ] as const) {
      const val = input[requiredKey];
      if (typeof val !== "string" || !val.trim() || val.length > 256 || val.includes("\0")) {
        throw new this.errorCtor(requiredKey, `${requiredKey} must be a non-empty string.`);
      }
    }
    if (this.cancelledRequests.has(input.requestId)) {
      throw new this.errorCtor("requestId", `Request '${input.requestId}' has been cancelled.`);
    }
    const primaryField = this.domainFieldNames[0];
    const rawRecord = input as unknown as Record<string, unknown>;
    const primary = rawRecord[primaryField];
    if (
      this.config.strictValidation &&
      (primary === undefined ||
        primary === null ||
        (typeof primary === "string" && !primary.trim()))
    ) {
      throw new this.errorCtor(
        primaryField,
        `Primary domain attribute '${primaryField}' cannot be empty.`
      );
    }
    for (const fieldKey of this.domainFieldNames) {
      const fieldVal = rawRecord[fieldKey];
      if (
        typeof fieldVal === "number" &&
        (!Number.isFinite(fieldVal) || Number.isNaN(fieldVal) || fieldVal < 0)
      ) {
        throw new this.errorCtor(
          fieldKey,
          `Numeric domain attribute '${fieldKey}' must be a non-negative finite number.`
        );
      }
    }
    this.validateDomainInvariants(input);
  }

  protected validateDomainInvariants(input: TInput): void {
    void input;
  }

  public execute(input: TInput): TOutput {
    const startedMs = performance.now();
    this.totalRuns += 1;
    try {
      this.validateInput(input);
      const rawRecord = input as unknown as Record<string, unknown>;
      const [f0, f1, f2, f3] = this.domainFieldNames;
      const domainFields: Record<string, unknown> = {
        [f0]: rawRecord[f0],
        [f1]: rawRecord[f1],
        [f2]: rawRecord[f2],
        [f3]: rawRecord[f3]
      };
      const canonicalPayload = JSON.stringify({
        featureId: this.config.featureId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields
      });
      const prefix = this.config.featureId.toLowerCase();
      const payloadHash = `${prefix}_${sha256Hex(canonicalPayload).slice(0, 16)}`;

      const scopeKey = JSON.stringify([
        input.tenantId,
        input.workspaceId,
        input.projectId,
        input.actorId,
        input.requestId
      ]);
      const existing = this.idempotencyStore.get(scopeKey);
      if (existing) {
        if (existing.payloadHash !== payloadHash) {
          throw new this.errorCtor(
            "requestId",
            `Idempotency conflict: requestId '${input.requestId}' was already executed with a different payload.`
          );
        }
        this.successfulRuns += 1;
        return { ...structuredClone(existing.output), idempotentReplay: true };
      }

      if (this.idempotencyStore.size >= 1024) throw Error("APEX_REQUEST_CACHE_FULL");
      const kernelResult = this.kernel.executeDomainOperation({
        featureId: this.config.featureId,
        operationCode: this.config.operationCode,
        requestId: input.requestId,
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        autonomyLevel: input.autonomyLevel,
        domainFields
      });

      const executionId = `exec_${prefix}_${this.totalRuns}_${kernelResult.provenanceSha256.slice(0, 10)}`;
      const timestampIso = new Date().toISOString();
      const provenanceDigest = `${prefix}_${kernelResult.provenanceSha256.slice(0, 16)}`;

      const auditRecord: BaseFeatureAuditEntry<TId> = {
        eventId: `aud_${executionId}`,
        featureId: this.config.featureId,
        tenantId: input.tenantId,
        projectId: input.projectId,
        actorId: input.actorId,
        action: `${this.config.operationCode}:executed`,
        payloadHash: provenanceDigest,
        recordedAt: timestampIso
      };
      if (this.config.enableAuditTrail) {
        this.auditLog.push(auditRecord);
      }

      const latencyMs = Math.max(0, performance.now() - startedMs);
      this.cumulativeLatencyMs += latencyMs;
      this.successfulRuns += 1;

      const output = {
        featureId: this.config.featureId,
        requestId: input.requestId,
        executionId,
        status: "completed",
        operationCode: this.config.operationCode,
        [`resolved_${f0}`]: kernelResult.resolvedFields[f0],
        [`resolved_${f1}`]: kernelResult.resolvedFields[f1],
        [`resolved_${f2}`]: kernelResult.resolvedFields[f2],
        [`resolved_${f3}`]: kernelResult.resolvedFields[f3],
        domainOutcome: kernelResult.domainOutcome,
        idempotentReplay: false,
        provenanceDigest,
        latencyMs,
        timestampIso,
        auditRecord
      } as unknown as TOutput;

      this.idempotencyStore.set(scopeKey, { payloadHash, output: structuredClone(output) });
      this.executionHistory.push(output);
      return structuredClone(output);
    } catch (err) {
      this.failedRuns += 1;
      throw err;
    }
  }

  public getTelemetrySnapshot(): BaseFeatureTelemetry<TId> {
    const last =
      this.executionHistory.length > 0
        ? this.executionHistory[this.executionHistory.length - 1]!.executionId
        : null;
    return {
      featureId: this.config.featureId,
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

  public getAuditTrail(): readonly BaseFeatureAuditEntry<TId>[] {
    return structuredClone(this.auditLog);
  }

  public getExecutionHistory(): readonly TOutput[] {
    return structuredClone(this.executionHistory);
  }
}

export class Stage1AutonomyKernel extends BoundApexKernel {
  constructor(operations?: ReadonlyMap<string, BoundApexOperation>) {
    super("stage1-autonomy", operations);
  }
}
