import { randomUUID } from "node:crypto";
import type {
  CapabilityId,
  ConfirmationRequest,
  PolicyIntent,
  PolicyVerdict
} from "@cosmora/contracts";
import { PolicyStoreConflictError } from "@cosmora/db";
import type { PolicyStore } from "@cosmora/db";
import { evaluatePolicy, getAppliedOverrideIds } from "@cosmora/policy-engine";

export interface ToolExecutionContext {
  operationId: string;
  projectId: string;
  actorId: string;
  idempotencyKey: string;
  objectIds: readonly string[];
  verdict: PolicyVerdict;
}

export interface GuardedTool<Input, Output> {
  id: string;
  resolveCapabilities(input: Input): readonly CapabilityId[];
  validateScopedExecution?(input: Input, verdict: PolicyVerdict): boolean;
  execute(input: Input, context: ToolExecutionContext): Promise<Output>;
}

export interface ToolInvocation<Input> {
  toolId: string;
  operationId?: string;
  projectId: string;
  actorId: string;
  objectIds: string[];
  purpose: string;
  idempotencyKey: string;
  input: Input;
}

export interface PolicyConditionResolutionInput {
  projectId: string;
  actorId: string;
  objectIds: readonly string[];
  capabilityIds: readonly CapabilityId[];
  evaluatedAt: string;
}

export type PolicyConditionResolver = (
  input: PolicyConditionResolutionInput
) => readonly string[] | Promise<readonly string[]>;

export interface GuardedToolRuntimeOptions {
  resolveActiveConditionIds?: PolicyConditionResolver;
  now?: () => string;
}

export type ToolInvocationResult<Output> =
  | { status: "EXECUTED"; verdict: PolicyVerdict; result: Output; replayed: false }
  | { status: "EXECUTED"; verdict: PolicyVerdict; result: Output; replayed: true }
  | { status: "WAITING_CONFIRMATION"; verdict: PolicyVerdict; confirmation: ConfirmationRequest }
  | { status: "DENIED" | "PAUSED" | "RECOVERY_REQUIRED"; verdict: PolicyVerdict }
  | { status: "FAILED"; verdict: PolicyVerdict; errorCode: string };

const asReplay = <Output>(value: unknown): Output => value as Output;

const pausedVerdict = (
  intent: PolicyIntent,
  evaluatedAt: string,
  reason: string
): PolicyVerdict => ({
  operation_id: intent.operation_id,
  verdict: "PAUSE",
  evaluated_capabilities: intent.capability_ids.map((capabilityId) => ({
    capability_id: capabilityId,
    mode: "DENY",
    scope: [],
    conditions: []
  })),
  permission_ids: [],
  reasons: [reason],
  evaluated_at: evaluatedAt,
  policy_version: "1.1.0"
});

export class GuardedToolRuntime {
  readonly #policyStore: PolicyStore;
  readonly #tools = new Map<string, GuardedTool<unknown, unknown>>();
  readonly #resolveActiveConditionIds: PolicyConditionResolver;
  readonly #now: () => string;

  constructor(policyStore: PolicyStore, options: GuardedToolRuntimeOptions = {}) {
    this.#policyStore = policyStore;
    this.#resolveActiveConditionIds = options.resolveActiveConditionIds ?? (() => []);
    this.#now = options.now ?? (() => new Date().toISOString());
  }

  register<Input, Output>(tool: GuardedTool<Input, Output>): void {
    if (this.#tools.has(tool.id)) throw new Error(`Tool ${tool.id} is already registered`);
    this.#tools.set(tool.id, tool);
  }

  async invoke<Input, Output>(
    invocation: ToolInvocation<Input>
  ): Promise<ToolInvocationResult<Output>> {
    const evaluatedAt = this.#now();
    const registered = this.#tools.get(invocation.toolId);
    const existingOperation = this.#policyStore.getOperation(
      invocation.projectId,
      invocation.idempotencyKey
    );
    const operationId = invocation.operationId ?? existingOperation?.operation_id ?? randomUUID();
    if (!registered) {
      const intent: PolicyIntent = {
        operation_id: operationId,
        project_id: invocation.projectId,
        actor_id: invocation.actorId,
        capability_ids: ["integration.private.use"],
        object_ids: invocation.objectIds,
        purpose: invocation.purpose,
        idempotency_key: invocation.idempotencyKey
      };
      const verdict = pausedVerdict(
        intent,
        evaluatedAt,
        `Tool ${invocation.toolId} is not registered.`
      );
      return { status: "PAUSED", verdict };
    }

    const capabilityIds = [...new Set(registered.resolveCapabilities(invocation.input))].sort();
    if (capabilityIds.length === 0) {
      const intent: PolicyIntent = {
        operation_id: operationId,
        project_id: invocation.projectId,
        actor_id: invocation.actorId,
        capability_ids: ["integration.private.use"],
        object_ids: invocation.objectIds,
        purpose: invocation.purpose,
        idempotency_key: invocation.idempotencyKey
      };
      const verdict = pausedVerdict(intent, evaluatedAt, "Tool declared no capabilities.");
      return { status: "PAUSED", verdict };
    }

    const intent: PolicyIntent = {
      operation_id: operationId,
      project_id: invocation.projectId,
      actor_id: invocation.actorId,
      capability_ids: capabilityIds,
      object_ids: [...new Set(invocation.objectIds)].sort(),
      purpose: invocation.purpose,
      idempotency_key: invocation.idempotencyKey
    };

    const existing = existingOperation;
    if (existing) {
      if (JSON.stringify(existing.intent) !== JSON.stringify(intent)) {
        const verdict = pausedVerdict(
          intent,
          evaluatedAt,
          "Idempotency key conflicts with another intent."
        );
        return { status: "PAUSED", verdict };
      }
      if (existing.status === "SUCCEEDED") {
        return {
          status: "EXECUTED",
          verdict: existing.verdict,
          result: asReplay<Output>(existing.result),
          replayed: true
        };
      }
      if (existing.status === "WAITING_CONFIRMATION") {
        const confirmation = existing.confirmation_id
          ? this.#policyStore.getConfirmation(existing.confirmation_id)
          : null;
        if (confirmation?.status === "PENDING") {
          return { status: "WAITING_CONFIRMATION", verdict: existing.verdict, confirmation };
        }
        if (confirmation?.status === "REJECTED" || confirmation?.status === "EXPIRED") {
          return { status: "PAUSED", verdict: existing.verdict };
        }
      }
      if (existing.status === "RESERVED") {
        return { status: "RECOVERY_REQUIRED", verdict: existing.verdict };
      }
      if (existing.status === "DENIED") return { status: "DENIED", verdict: existing.verdict };
      if (existing.status === "PAUSED" || existing.status === "FAILED") {
        return { status: "PAUSED", verdict: existing.verdict };
      }
    }

    const profile = this.#policyStore.getProfile(intent.project_id);
    if (!profile) {
      const verdict = pausedVerdict(intent, evaluatedAt, "Project has no autonomy profile.");
      return { status: "PAUSED", verdict };
    }
    const permissionContracts = this.#policyStore.listActivePermissions(
      intent.project_id,
      intent.actor_id,
      evaluatedAt,
      intent.operation_id
    );
    let activeConditionIds: string[];
    try {
      activeConditionIds = [
        ...new Set(
          await this.#resolveActiveConditionIds({
            projectId: intent.project_id,
            actorId: intent.actor_id,
            objectIds: intent.object_ids,
            capabilityIds: intent.capability_ids,
            evaluatedAt
          })
        )
      ].sort();
    } catch {
      const verdict = pausedVerdict(
        intent,
        evaluatedAt,
        "Authoritative policy condition resolution failed."
      );
      return { status: "PAUSED", verdict };
    }
    let verdict = evaluatePolicy(
      { intent, profile, permissionContracts },
      {
        evaluatedAt,
        activeConditionIds
      }
    );

    if (verdict.verdict === "ALLOW_WITH_LIMITS") {
      const limitsAccepted =
        registered.validateScopedExecution?.(invocation.input, verdict) ?? false;
      if (!limitsAccepted) {
        verdict = {
          ...verdict,
          verdict: "PAUSE",
          reasons: [
            ...verdict.reasons,
            "Tool did not validate the scoped controls required by policy."
          ]
        };
      }
    }

    try {
      if (verdict.verdict === "NEEDS_CONFIRMATION") {
        const confirmation = this.#policyStore.createConfirmation(intent, verdict, evaluatedAt);
        return { status: "WAITING_CONFIRMATION", verdict, confirmation };
      }
      if (verdict.verdict === "DENY" || verdict.verdict === "PAUSE") {
        const status = verdict.verdict === "DENY" ? "DENIED" : "PAUSED";
        this.#policyStore.recordBlocked(intent, verdict, status, evaluatedAt);
        return { status, verdict };
      }

      const reservation = this.#policyStore.reserveAllowed(
        intent,
        verdict,
        {
          profileVersion: profile.version,
          appliedOverrideIds: getAppliedOverrideIds(profile, intent, evaluatedAt),
          activeConditionIds
        },
        evaluatedAt
      );
      if (reservation.status === "REPLAY") {
        return {
          status: "EXECUTED",
          verdict: reservation.operation.verdict,
          result: asReplay<Output>(reservation.operation.result),
          replayed: true
        };
      }
      if (reservation.status === "RECOVERY_REQUIRED") {
        return { status: "RECOVERY_REQUIRED", verdict: reservation.operation.verdict };
      }
      if (reservation.status === "AUTHORITY_CHANGED") {
        const blocked = pausedVerdict(
          intent,
          evaluatedAt,
          "Autonomy profile changed or an applicable point override was exhausted after policy evaluation."
        );
        return { status: "PAUSED", verdict: blocked };
      }
      if (reservation.status !== "RESERVED") {
        const blocked = pausedVerdict(
          intent,
          evaluatedAt,
          "Permission was exhausted or operation is blocked."
        );
        return { status: "PAUSED", verdict: blocked };
      }

      try {
        const result = await registered.execute(invocation.input, {
          operationId: intent.operation_id,
          projectId: intent.project_id,
          actorId: intent.actor_id,
          idempotencyKey: intent.idempotency_key,
          objectIds: intent.object_ids,
          verdict
        });
        this.#policyStore.completeOperation(intent.operation_id, result);
        return { status: "EXECUTED", verdict, result: result as Output, replayed: false };
      } catch {
        return { status: "RECOVERY_REQUIRED", verdict };
      }
    } catch (error) {
      if (error instanceof PolicyStoreConflictError) {
        const conflict = pausedVerdict(intent, evaluatedAt, error.message);
        return { status: "PAUSED", verdict: conflict };
      }
      throw error;
    }
  }
}
