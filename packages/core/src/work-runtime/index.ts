import type { ManagerWork, WorkRuntimeProgress, WorkRuntimeTask } from "@cosmora/contracts";

/** The executable basic graph follows the existing Manager, not an independent executor. */
export function workRuntimeProgress(work: ManagerWork): WorkRuntimeProgress {
  const stages = ["plan", "draft", "review", "publish"] as const;
  const titles = [
    "Подготовить план",
    "Создать файлы по плану",
    "Проверить результат",
    "Сохранить результат"
  ];
  const ids = stages.map((stage) => `${work.id}:${stage}`);
  const tasks: WorkRuntimeTask[] = stages.map((stage, index) => {
    const skipped = stage === "review" && work.plan !== null && !work.plan.needs_critic;
    const complete =
      stage === "plan"
        ? Boolean(work.plan && !work.plan.requires_external_actions)
        : stage === "draft"
          ? Boolean(work.draft)
          : stage === "review"
            ? work.review?.verdict === "PASS"
            : work.status === "completed";
    const failed = stage === "review" && work.review?.verdict === "FAIL";
    const current = work.stage === stage;
    const dependency =
      index === 0 ? [] : [ids[stage === "publish" && !work.plan?.needs_critic ? 1 : index - 1]!];
    return {
      task_id: ids[index]!,
      stage,
      title: titles[index]!,
      depends_on: dependency,
      status: skipped
        ? "skipped"
        : failed
          ? "failed"
          : complete
            ? "completed"
            : work.status === "cancelled"
              ? "cancelled"
              : current && work.status === "failed"
                ? "failed"
                : current && work.status === "running"
                  ? "running"
                  : current && ["paused", "awaiting_approval", "blocked"].includes(work.status)
                    ? "waiting"
                    : "pending"
    };
  });
  for (const task of tasks) {
    if (
      task.status === "pending" &&
      work.status === "queued" &&
      task.depends_on.every((id) =>
        tasks.some((t) => t.task_id === id && ["completed", "skipped"].includes(t.status))
      )
    )
      task.status = "ready";
  }
  return {
    contract_version: "kosmora-work-v1",
    work_id: work.id,
    tasks,
    completed: tasks.filter((t) => ["completed", "skipped"].includes(t.status)).length,
    total: tasks.length,
    next_task_id:
      tasks.find((t) => ["ready", "running", "waiting"].includes(t.status))?.task_id ?? null,
    waiting_decision:
      work.error_code === "RECOVERY_REQUIRED"
        ? "recovery"
        : work.status === "awaiting_approval"
          ? "plan"
          : work.status === "blocked"
            ? "permission"
            : work.status === "paused"
              ? "resume"
              : null,
    restores_permissions: false
  };
}

export function assertWorkTaskGraph(tasks: WorkRuntimeTask[]): void {
  const byId = new Map(tasks.map((t) => [t.task_id, t]));
  if (tasks.length === 0 || tasks.length > 32 || byId.size !== tasks.length)
    throw new Error("INVALID_WORK_GRAPH");
  const visiting = new Set<string>(),
    visited = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task || visiting.has(id)) throw new Error("INVALID_WORK_GRAPH");
    visiting.add(id);
    for (const dependency of task.depends_on) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}
