import type { ProjectStore } from "@cosmora/db";
import type { ModelRouteAttempt } from "@cosmora/model-gateway";

export type CodeOwnerBudgetKey = { ownerId: string; runId: string; attempt: number };
/** Structural port for the shared AccountStore. No balances or reservations stored by Code.
 * All calls must be durable/idempotent by (ownerId,runId,attempt).
 * reserve must fail closed when upper bound/pricing is unknown under owner's policy.
 * reconcile consumes canonical ledger rows; null usage/cost and failed/cancelled rows retain
 * the uncertain reservation. Only releaseBeforeDispatch can release proven local failures.
 */
export interface CodeOwnerBudget {
  reserve(
    input: CodeOwnerBudgetKey & { projectId: string; route: ModelRouteAttempt }
  ): boolean | Promise<boolean>;
  reconcile(
    input: CodeOwnerBudgetKey & { ledger: ReturnType<ProjectStore["getModelUsageForRun"]> }
  ): void | Promise<void>;
  releaseBeforeDispatch(
    input: CodeOwnerBudgetKey & { reason: "local_before_dispatch" }
  ): void | Promise<void>;
}
