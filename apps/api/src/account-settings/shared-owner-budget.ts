import type { ModelGatewayStreamEvent, ModelRouteAttempt } from "@cosmora/model-gateway";
import type { ProjectStore } from "@cosmora/db";
import type { AccountStore } from "./account-store.js";
import type { DocumentAnswerOwnerBudget } from "../document-answer-service.js";
import type { CodeOwnerBudget } from "../code-agent/owner-budget.js";

/** One AccountStore + canonical project ledger. No second mutable global counter. */
export class SharedOwnerBudget implements DocumentAnswerOwnerBudget, CodeOwnerBudget {
  constructor(
    private readonly account: AccountStore,
    private readonly projects: ProjectStore
  ) {}
  private hold(owner: string, runId: string, attempt: number): string | null {
    const row = this.account.sqlite
      .prepare("SELECT id FROM kosmora_usage_holds WHERE owner_id=? AND run_id=? AND attempt=?")
      .get(owner, runId, attempt) as { id: string } | undefined;
    return row?.id ?? null;
  }
  reserve(owner: string, runId: string, route: ModelRouteAttempt): boolean;
  reserve(input: {
    ownerId: string;
    runId: string;
    attempt: number;
    projectId: string;
    route: ModelRouteAttempt;
  }): boolean;
  reserve(
    input:
      | string
      | {
          ownerId: string;
          runId: string;
          attempt: number;
          projectId: string;
          route: ModelRouteAttempt;
        },
    runId?: string,
    route?: ModelRouteAttempt
  ): boolean {
    const owner = typeof input === "string" ? input : input.ownerId;
    const id = typeof input === "string" ? runId! : input.runId;
    const r = typeof input === "string" ? route! : input.route;
    if (
      !Number.isSafeInteger(r.estimated_input_tokens) ||
      r.estimated_input_tokens < 1 ||
      !Number.isSafeInteger(r.max_output_tokens) ||
      r.max_output_tokens < 1
    )
      return false;
    const projectId =
      typeof input === "string"
        ? (
            this.account.sqlite
              .prepare("SELECT project_id FROM document_answer_runs WHERE id=? AND owner_id=?")
              .get(id, owner) as { project_id: string } | undefined
          )?.project_id
        : input.projectId;
    if (!projectId || !this.projects.getProject(projectId, owner)) return false;
    this.account.reserve(
      owner,
      id,
      r.attempt,
      r.estimated_input_tokens + r.max_output_tokens,
      "main",
      projectId,
      r.provider_id,
      r.model_id
    );
    return true;
  }
  async reconcile(
    owner: string,
    runId: string,
    event: Extract<ModelGatewayStreamEvent, { type: "response.completed" }>
  ): Promise<void>;
  async reconcile(input: {
    ownerId: string;
    runId: string;
    attempt: number;
    ledger: ReturnType<ProjectStore["getModelUsageForRun"]>;
  }): Promise<void>;
  // Budget contracts are async; SQLite reservation reconciliation must remain synchronous.
  // eslint-disable-next-line @typescript-eslint/require-await
  async reconcile(
    input:
      | string
      | {
          ownerId: string;
          runId: string;
          attempt: number;
          ledger: ReturnType<ProjectStore["getModelUsageForRun"]>;
        },
    runId?: string,
    event?: Extract<ModelGatewayStreamEvent, { type: "response.completed" }>
  ): Promise<void> {
    if (typeof input === "string") {
      const r = event!.route;
      const id = this.hold(input, runId!, r.attempt);
      if (
        event!.usage.inputTokens === null ||
        event!.usage.outputTokens === null ||
        !event!.calculatedCost
      ) {
        if (id) this.account.uncertainReservation(id, "main");
        return;
      }
      this.account.completeAuxiliary(
        input,
        runId!,
        r.attempt,
        "document",
        event!.provider,
        event!.model,
        event!.usage.inputTokens,
        event!.usage.outputTokens,
        event!.calculatedCost.amount,
        event!.calculatedCost.currency
      );
      return;
    }
    const id = this.hold(input.ownerId, input.runId, input.attempt);
    if (!id) return;
    const matching = input.ledger.find((x) => x.attempt === input.attempt);
    if (
      matching?.status === "committed" &&
      matching.actual_input_tokens !== null &&
      matching.actual_output_tokens !== null &&
      matching.calculated_cost_amount !== null
    )
      this.account.completeReservation(
        id,
        "main",
        matching.actual_input_tokens,
        matching.actual_output_tokens
      );
    else this.account.uncertainReservation(id, "main");
  }
  uncertain(owner: string, runId: string, route: ModelRouteAttempt, reason: string): void {
    void reason;
    const id = this.hold(owner, runId, route.attempt);
    if (id) this.account.uncertainReservation(id, "main");
  }
  releaseBeforeDispatch(input: {
    ownerId: string;
    runId: string;
    attempt: number;
    reason: "local_before_dispatch";
  }): void {
    const id = this.hold(input.ownerId, input.runId, input.attempt);
    if (id) this.account.releaseBeforeDispatch(id);
  }
}
