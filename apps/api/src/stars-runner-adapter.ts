import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Isolated Stars runner adapter for tests. It really writes artifacts and a
 * checkpoint into a dedicated temp workspace, but it is NOT a cloud runner and
 * never contacts a VPS. Production remote runners plug in at the same lease
 * boundary with a real environment adapter. */
export type IsolatedRunnerTask = {
  task_id: string;
  holder: string;
  goal: string;
  steps: string[];
};
export type IsolatedRunnerResult = {
  task_id: string;
  workspace: string;
  checkpoint: string;
  artifacts: Array<{ name: string; sha256: string }>;
  completed: boolean;
  cancelled: boolean;
};
export class IsolatedRunnerError extends Error {
  constructor(readonly code: "CANCELLED" | "ALREADY_DONE" | "INVALID_TASK") {
    super(code);
  }
}
export function dispatchIsolatedRunner(
  root: string,
  task: IsolatedRunnerTask,
  onStep?: (index: number) => boolean | void
): IsolatedRunnerResult {
  if (!task.task_id || !task.holder || !task.steps.length)
    throw new IsolatedRunnerError("INVALID_TASK");
  const workspace = join(root, task.task_id.replace(/[^a-zA-Z0-9_-]/gu, "_"));
  mkdirSync(workspace, { recursive: true });
  if (
    existsSync(join(workspace, "status.json")) &&
    JSON.parse(readFileSync(join(workspace, "status.json"), "utf8")).status === "completed"
  )
    throw new IsolatedRunnerError("ALREADY_DONE");
  const completed: string[] = [];
  let index = 0;
  for (const step of task.steps) {
    if (onStep?.(index) === false) {
      writeFileSync(
        join(workspace, "status.json"),
        JSON.stringify({ status: "cancelled", completed, cancelled: true }, null, 2)
      );
      throw new IsolatedRunnerError("CANCELLED");
    }
    completed.push(step);
    writeFileSync(
      join(workspace, "checkpoint.json"),
      JSON.stringify({ task_id: task.task_id, holder: task.holder, completed }, null, 2)
    );
    index++;
  }
  const reportPath = join(workspace, "report.txt");
  writeFileSync(reportPath, `${task.goal}\n${completed.join("\n")}\n`, "utf8");
  writeFileSync(
    join(workspace, "status.json"),
    JSON.stringify({ status: "completed", completed, cancelled: false }, null, 2)
  );
  const bytes = readFileSync(reportPath);
  return {
    task_id: task.task_id,
    workspace,
    checkpoint: join(workspace, "checkpoint.json"),
    artifacts: [{ name: "report.txt", sha256: createHash("sha256").update(bytes).digest("hex") }],
    completed: true,
    cancelled: false
  };
}

/** Resume from the exact checkpoint without redoing completed steps. */
export function resumeIsolatedRunner(root: string, task: IsolatedRunnerTask): IsolatedRunnerResult {
  const workspace = join(root, task.task_id.replace(/[^a-zA-Z0-9_-]/gu, "_"));
  let done: string[] = [];
  try {
    const checkpoint = JSON.parse(readFileSync(join(workspace, "checkpoint.json"), "utf8")) as {
      completed: string[];
    };
    done = checkpoint.completed ?? [];
  } catch {
    // No checkpoint means a fresh run.
  }
  const remaining = task.steps.slice(done.length);
  return dispatchIsolatedRunner(root, { ...task, steps: remaining });
}
