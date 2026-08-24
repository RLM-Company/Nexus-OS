import { randomUUID } from "node:crypto";
import type {
  CapabilityId,
  ConfirmationRequest,
  PolicyIntent,
  PolicyVerdict
} from "@nexus/contracts";
import { PolicyStoreConflictError } from "@nexus/db";
import type { PolicyStore } from "@nexus/db";
import { evaluatePolicy } from "@nexus/policy-engine";

export interface ToolExecutionContext {
  operationId: string;
  projectId: string;
  actorId: string;
  idempotencyKey: string;
  objectIds: readonly string[];
}

export interface GuardedTool<Input, Output> {
  id: string;
  resolveCapabilities(input: Input): readonly CapabilityId[];
  supportsScopedExecution: boolean;
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
  activeConditionIds?: string[];
  evaluatedAt?: string;
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

  constructor(policyStore: PolicyStore) {
    this.#policyStore = policyStore;
  }

  register<Input, Output>(tool: GuardedTool<Input, Output>): void {
    if (this.#tools.has(tool.id)) throw new Error(`Tool ${tool.id} is already registered`);
    this.#tools.set(tool.id, tool);
  }

  async invoke<Input, Output>(
    invocation: ToolInvocation<Input>
  ): Promise<ToolInvocationResult<Output>> {
    const evaluatedAt = invocation.evaluatedAt ?? new Date().toISOString();
    const registered = this.#tools.get(invocation.toolId);
    const operationId = invocation.operationId ?? randomUUID();
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

    const capabilityIds = [...new Set(registered.resolveCapabilities(invocation.input))];
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
      object_ids: invocation.objectIds,
      purpose: invocation.purpose,
      idempotency_key: invocation.idempotencyKey
    };

    const existing = this.#policyStore.getOperation(intent.project_id, intent.idempotency_key);
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
        if (confirmation) {
          return { status: "WAITING_CONFIRMATION", verdict: existing.verdict, confirmation };
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
      evaluatedAt
    );
    let verdict = evaluatePolicy(
      { intent, profile, permissionContracts },
      {
        evaluatedAt,
        activeConditionIds: invocation.activeConditionIds ?? []
      }
    );

    if (verdict.verdict === "ALLOW_WITH_LIMITS" && !registered.supportsScopedExecution) {
      verdict = {
        ...verdict,
        verdict: "PAUSE",
        reasons: [...verdict.reasons, "Tool cannot enforce the scoped controls required by policy."]
      };
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

      const reservation = this.#policyStore.reserveAllowed(intent, verdict, evaluatedAt);
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
          objectIds: intent.object_ids
        });
        this.#policyStore.completeOperation(intent.operation_id, result);
        return { status: "EXECUTED", verdict, result: result as Output, replayed: false };
      } catch (error) {
        const errorCode = error instanceof Error ? error.name : "TOOL_EXECUTION_ERROR";
        this.#policyStore.failOperation(intent.operation_id, errorCode);
        return { status: "FAILED", verdict, errorCode };
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
