import type { RuntimeCheckpoint } from "@cosmora/contracts";
import { LOCAL_OWNER_ID, type DemoManagerStore, type StoredDemoManagerRun } from "@cosmora/db";

/**
 * Executes the first demo's intentionally bounded workflow. This coordinator never
 * calls a provider, Tool Runtime, network, filesystem or external integration. Its
 * middle step is a deterministic stand-in for a future read-only context executor.
 */
export class DemoManagerCoordinator {
  readonly #store: DemoManagerStore;

  constructor(store: DemoManagerStore) {
    this.#store = store;
  }

  execute(demoRunId: string, ownerId?: string): StoredDemoManagerRun | null {
    const effectiveOwnerId = ownerId ?? LOCAL_OWNER_ID;
    const before = this.#store.get(demoRunId, effectiveOwnerId);
    if (!before || before.status !== "queued") return before;
    if (!this.#store.claim(demoRunId, effectiveOwnerId)) {
      return this.#store.get(demoRunId, effectiveOwnerId);
    }

    const running = this.#store.get(demoRunId, effectiveOwnerId);
    if (!running || running.status !== "running") return running;
    const [planTask, contextTask, handoffTask] = running.graph.nodes;
    if (!planTask || !contextTask || !handoffTask) {
      throw new Error("Demo Manager graph must contain its three bounded tasks");
    }

    const plan = this.#store.appendArtifact({
      demo_run_id: running.demo_run_id,
      project_id: running.project_id,
      task_id: planTask.task_id,
      kind: "plan",
      content: `Цель владельца: ${running.owner_goal}\n1. Сформировать план.\n2. Проверить доступный контекст проекта.\n3. Собрать итог и checkpoint.`,
      ownerId: effectiveOwnerId
    });
    if (!plan) return this.#store.get(demoRunId, effectiveOwnerId);

    const analysis = this.#store.appendArtifact({
      demo_run_id: running.demo_run_id,
      project_id: running.project_id,
      task_id: contextTask.task_id,
      kind: "analysis",
      content:
        "Демо-проверка контекста выполнена synthetic/read-only executor-ом. Внешние сервисы, сеть, файлы и модель не вызывались.",
      ownerId: effectiveOwnerId
    });
    if (!analysis) return this.#store.get(demoRunId, effectiveOwnerId);

    const handoff = this.#store.appendArtifact({
      demo_run_id: running.demo_run_id,
      project_id: running.project_id,
      task_id: handoffTask.task_id,
      kind: "handoff",
      content:
        "Демо-план завершён. Следующее действие требует отдельного разрешённого executor-а; автоматический переход к внешним действиям не выполнялся.",
      ownerId: effectiveOwnerId
    });
    if (!handoff) return this.#store.get(demoRunId, effectiveOwnerId);

    const checkpoint: RuntimeCheckpoint = {
      contract_version: 1,
      checkpoint_id: `${running.demo_run_id}:checkpoint:1`,
      project_id: running.project_id,
      graph_id: running.graph.graph_id,
      task_states: running.graph.nodes.map((task) => ({
        task_id: task.task_id,
        status: "completed"
      })),
      artifact_ids: [plan.artifact_id, analysis.artifact_id, handoff.artifact_id],
      open_conflict_ids: [],
      restores_permissions: false,
      restores_sessions: false,
      restores_autonomy_escalation: false,
      created_at: new Date().toISOString()
    };
    return this.#store.complete(demoRunId, checkpoint, effectiveOwnerId);
  }
}
