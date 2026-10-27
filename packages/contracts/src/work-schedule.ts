import type { WorkDag, WorkDagNode, WorkDagNodeInput } from "./work-dag.js";

export type WorkPriority = "low" | "normal" | "high" | "urgent";
const priorityRank: Record<WorkPriority, number> = { low: 0, normal: 1, high: 2, urgent: 3 };

export function isWorkPriority(value: unknown): value is WorkPriority {
  return typeof value === "string" && Object.hasOwn(priorityRank, value);
}

/** UTC only; reject dates that Date.parse would silently normalize, such as February 30. */
export function isWorkDeadline(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  )
    return false;
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() ===
      (value.includes(".") ? value : value.replace("Z", ".000Z"))
  );
}

export function compareWorkSchedule(a: WorkDagNodeInput, b: WorkDagNodeInput): number {
  const priority = priorityRank[b.priority ?? "normal"] - priorityRank[a.priority ?? "normal"];
  if (priority) return priority;
  const left = a.deadline ? Date.parse(a.deadline) : Infinity;
  const right = b.deadline ? Date.parse(b.deadline) : Infinity;
  return left === right ? 0 : left < right ? -1 : 1;
}

/** Select only never-started, dependency-ready steps. This never starts work or changes the DAG. */
export function scheduledReadyWorkNodes(graph: Pick<WorkDag, "nodes">): WorkDagNode[] {
  const completed = new Set(
    graph.nodes.filter((node) => node.status === "completed").map((node) => node.id)
  );
  return graph.nodes
    .map((node, index) => ({ node, index }))
    .filter(
      ({ node }) =>
        node.status === "pending" &&
        !node.attempts.length &&
        node.depends_on.every((id) => completed.has(id))
    )
    .sort((a, b) => compareWorkSchedule(a.node, b.node) || a.index - b.index)
    .map(({ node }) => node);
}
