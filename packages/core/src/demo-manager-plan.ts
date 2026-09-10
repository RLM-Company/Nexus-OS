import {
  validateRuntimeTaskGraph,
  type RuntimeTaskGraph,
  type RuntimeTaskNode
} from "@cosmora/contracts";

export interface DemoManagerPlanInput {
  projectId: string;
  ownerGoal: string;
  createdAt: string;
  createId: () => string;
}

export interface DemoManagerPlan {
  graph: RuntimeTaskGraph;
  visibleSteps: readonly {
    taskId: string;
    title: string;
    execution: "manager" | "synthetic_read_only";
  }[];
}

const normalizedGoal = (value: string): string => value.replace(/\s+/g, " ").trim();

const task = (
  input: DemoManagerPlanInput,
  taskId: string,
  assignedRole: RuntimeTaskNode["assigned_role"],
  dependsOn: string[],
  expectedOutputKinds: RuntimeTaskNode["expected_output_kinds"]
): RuntimeTaskNode => ({
  task_id: taskId,
  project_id: input.projectId,
  assigned_role: assignedRole,
  status: "pending",
  depends_on: dependsOn,
  input_artifact_ids: [],
  expected_output_kinds: expectedOutputKinds,
  memory_scope: { read_mode: "task", source_ids: [], write_back: "result_only" },
  max_iterations: 1,
  timeout_ms: 30_000,
  created_at: input.createdAt
});

/**
 * Produces the first demo's deliberately bounded plan. It contains no model prompt,
 * provider configuration or executable tool request. The only non-manager step is
 * explicitly marked for a synthetic, read-only executor by the caller-facing plan.
 */
export const composeDemoManagerPlan = (input: DemoManagerPlanInput): DemoManagerPlan => {
  const ownerGoal = normalizedGoal(input.ownerGoal);
  if (ownerGoal.length === 0) throw new Error("Demo Manager plan requires an owner goal");

  const graphId = input.createId();
  const planTaskId = input.createId();
  const contextTaskId = input.createId();
  const handoffTaskId = input.createId();
  const graph: RuntimeTaskGraph = {
    contract_version: 1,
    graph_id: graphId,
    project_id: input.projectId,
    root_task_id: planTaskId,
    nodes: [
      task(input, planTaskId, "manager", [], ["plan"]),
      task(input, contextTaskId, "analyst", [planTaskId], ["analysis"]),
      task(input, handoffTaskId, "manager", [contextTaskId], ["handoff", "checkpoint"])
    ],
    created_at: input.createdAt
  };
  const issues = validateRuntimeTaskGraph(graph);
  if (issues.length > 0) throw new Error(`Demo Manager plan is invalid: ${issues.join("; ")}`);

  return {
    graph,
    visibleSteps: [
      {
        taskId: planTaskId,
        title: `Сформировать план: ${ownerGoal}`,
        execution: "manager"
      },
      {
        taskId: contextTaskId,
        title: "Проверить контекст проекта (только чтение)",
        execution: "synthetic_read_only"
      },
      {
        taskId: handoffTaskId,
        title: "Собрать результат и checkpoint",
        execution: "manager"
      }
    ]
  };
};
