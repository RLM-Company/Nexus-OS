import type { WorkDag } from "@cosmora/contracts";
import { describe, expect, it } from "vitest";
import {
  blockActiveStep,
  chatTaskPlanKey,
  clearChatTaskPlan,
  completeStep,
  createChatTaskPlan,
  formatDuration,
  nextReadyStep,
  pauseActiveStep,
  planSummary,
  projectChatTaskPlan,
  readChatTaskPlan,
  recordInterval,
  resumeActiveStep,
  saveChatTaskPlan,
  startStep,
  unblockActiveStep
} from "./chat-task-plan";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

const input = {
  id: "plan-1",
  scope: "chat-a",
  goal: "Подготовить отчёт по проекту",
  steps: [
    { id: "a", title: "Собрать данные" },
    { id: "b", title: "Написать отчёт", depends_on: ["a"] },
    { id: "c", title: "Проверить", depends_on: ["b"] }
  ],
  now: 1000
};

describe("chat task plan", () => {
  it("validates goal, unique step ids and real dependencies", () => {
    const plan = createChatTaskPlan(input);
    expect(plan.goal).toBe("Подготовить отчёт по проекту");
    expect(plan.steps).toHaveLength(3);
    expect(nextReadyStep(plan.steps)?.id).toBe("a");
    expect(() => createChatTaskPlan({ ...input, steps: [] })).toThrow();
    expect(() =>
      createChatTaskPlan({
        ...input,
        steps: [{ ...input.steps[0]!, id: "a" }, { ...input.steps[0]! }]
      })
    ).toThrow();
    expect(() =>
      createChatTaskPlan({
        ...input,
        steps: [{ id: "x", title: "Шаг", depends_on: ["missing"] }]
      })
    ).toThrow();
  });

  it("starts only an available step and takes the next one on completion", () => {
    let plan = createChatTaskPlan(input);
    expect(startStep(plan, "b", 1100)).toBe(plan); // dependency not completed
    plan = startStep(plan, "a", 1100);
    expect(plan.active_step_id).toBe("a");
    expect(plan.steps[0]!.status).toBe("running");
    plan = completeStep(plan, "a", 1500);
    expect(plan.steps[0]!.status).toBe("completed");
    expect(plan.steps[1]!.status).toBe("running"); // auto-promoted
    expect(plan.active_step_id).toBe("b");
    expect(completeStep(plan, "b", 1900).active_step_id).toBe("c");
    expect(completeStep(plan, "b", 1900).steps[0]!.status).toBe("completed");
  });

  it("never re-runs a completed step after reload", () => {
    const storage = new MemoryStorage();
    let plan = startStep(createChatTaskPlan(input), "a", 1000);
    plan = completeStep(plan, "a", 1400);
    saveChatTaskPlan(storage, plan);
    expect(storage.values.has(chatTaskPlanKey("chat-a"))).toBe(true);
    const restored = readChatTaskPlan(storage, "chat-a")!;
    expect(restored.steps[0]!.status).toBe("completed");
    expect(restored.active_step_id).toBe("b");
    expect(startStep(restored, "a", 2000)).toBe(restored);
    expect(readChatTaskPlan(storage, "chat-b")).toBeNull();
    clearChatTaskPlan(storage, "chat-a");
    expect(readChatTaskPlan(storage, "chat-a")).toBeNull();
  });

  it("ignores damaged, stale and foreign records", () => {
    const storage = new MemoryStorage();
    const key = chatTaskPlanKey("chat-a");
    storage.setItem(key, "{broken");
    expect(readChatTaskPlan(storage, "chat-a")).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 9, saved_at: Date.now(), plan: {} }));
    expect(readChatTaskPlan(storage, "chat-a")).toBeNull();
    storage.setItem(key, JSON.stringify({ version: 1, saved_at: 0, plan: {} }));
    expect(readChatTaskPlan(storage, "chat-a")).toBeNull();
    expect(storage.values.has(key)).toBe(false);
    storage.setItem(
      key,
      JSON.stringify({
        version: 1,
        saved_at: Date.now(),
        plan: createChatTaskPlan({ ...input, scope: "chat-b" })
      })
    );
    expect(readChatTaskPlan(storage, "chat-a")).toBeNull();
  });

  it("records only measured intervals and keeps model/tool/queue/pause separate", () => {
    let plan = startStep(createChatTaskPlan(input), "a", 1000);
    expect(recordInterval(plan, "model", 2000, 1000)).toBe(plan); // negative
    expect(recordInterval(plan, "model", 1000, 1000)).toBe(plan); // zero
    plan = recordInterval(plan, "model", 1000, 1300);
    plan = recordInterval(plan, "tool", 1300, 1450);
    plan = recordInterval(plan, "queue", 1450, 1500);
    plan = recordInterval(plan, "pause", 1500, 1600);
    plan = recordInterval(plan, "await_owner", 1600, 1800);
    const summary = planSummary(plan);
    expect(summary.timing).toEqual({
      model: 300,
      tool: 150,
      queue: 50,
      pause: 100,
      await_owner: 200
    });
    expect(summary.total_ms).toBe(800);
    expect(summary.completed).toBe(0);
    expect(formatDuration(300)).toBe("0.3 с");
    expect(formatDuration(65_000)).toBe("1 мин 5 с");
    expect(formatDuration(0)).toBe("—");
  });

  it("keeps an owner pause distinct from an error or a permission gate (REG-1)", () => {
    const storage = new MemoryStorage();
    let plan = startStep(createChatTaskPlan(input), "a", 1000);
    plan = pauseActiveStep(plan);
    expect(plan.steps[0]!.status).toBe("paused");
    expect(plan.steps[0]!.block_reason).toBe("owner_pause");
    expect(plan.active_step_id).toBe("a");
    saveChatTaskPlan(storage, plan);
    const restored = readChatTaskPlan(storage, "chat-a")!;
    expect(restored.steps[0]!.status).toBe("paused");
    expect(planSummary(restored).paused).toBe(1);
    // Resume reverses only an explicit pause.
    plan = resumeActiveStep(restored);
    expect(plan.steps[0]!.status).toBe("running");
    expect(plan.steps[0]!.block_reason).toBeNull();

    // A permission gate is not cleared by a pause/resume.
    const gated = blockActiveStep(
      startStep(createChatTaskPlan(input), "a", 1000),
      "awaiting_permission"
    );
    expect(gated.steps[0]!.status).toBe("blocked");
    expect(gated.steps[0]!.block_reason).toBe("awaiting_permission");
    expect(resumeActiveStep(gated).steps[0]!.status).toBe("blocked");
    expect(unblockActiveStep(gated).steps[0]!.status).toBe("running");
  });

  it("starts a promoted step at the completion timestamp (REG-3)", () => {
    let plan = startStep(createChatTaskPlan(input), "a", 1000);
    plan = completeStep(plan, "a", 1500);
    const next = plan.steps.find((s) => s.id === "b")!;
    expect(next.status).toBe("running");
    expect(next.started_at).toBe(1500);
    expect(next.block_reason).toBeNull();
    expect(planSummary(plan).running).toBe(1);
    // A repeated run.started cannot re-admit the same step.
    expect(startStep(plan, "b", 1600)).toBe(plan);
  });

  it("does not mutate the previous snapshot when promoting the next step (REG-3)", () => {
    const started = startStep(createChatTaskPlan(input), "a", 1000);
    const completed = completeStep(started, "a", 1500);
    // The original snapshot must still show the first step running and the
    // second pending; mutating a shared object would corrupt saved/replayed state.
    expect(started.steps[0]!.status).toBe("running");
    expect(started.steps[1]!.status).toBe("pending");
    expect(started.active_step_id).toBe("a");
    expect(completed.steps[0]!.status).toBe("completed");
    expect(completed.steps[1]!.status).toBe("running");
  });

  it("takes one dependency-free step at a time (REG-2)", () => {
    const branched = createChatTaskPlan({
      ...input,
      steps: [
        { id: "a", title: "A" },
        { id: "b", title: "B", depends_on: ["a"] },
        { id: "c", title: "C", depends_on: ["a"] },
        { id: "d", title: "D", depends_on: ["b", "c"] }
      ]
    });
    let plan = startStep(branched, "a", 1000);
    plan = completeStep(plan, "a", 1200);
    expect(plan.active_step_id).toBe("b");
    expect(plan.steps.filter((s) => s.status === "running")).toHaveLength(1);
    plan = completeStep(plan, "b", 1400);
    expect(plan.active_step_id).toBe("c");
    expect(plan.steps.filter((s) => s.status === "running")).toHaveLength(1);
    plan = completeStep(plan, "c", 1600);
    expect(plan.active_step_id).toBe("d");
    expect(planSummary(plan).completed).toBe(3);
  });

  it("survives a reload with a permission gate and its measured wait time", () => {
    const storage = new MemoryStorage();
    let plan = startStep(createChatTaskPlan(input), "a", 1000);
    plan = recordInterval(plan, "await_owner", 1000, 1250);
    plan = blockActiveStep(plan, "awaiting_permission");
    saveChatTaskPlan(storage, plan);
    const restored = readChatTaskPlan(storage, "chat-a")!;
    expect(restored.steps[0]!.block_reason).toBe("awaiting_permission");
    expect(planSummary(restored).timing.await_owner).toBe(250);
    // A gate cannot be resumed by a plain resume; only an explicit approval.
    expect(resumeActiveStep(restored).steps[0]!.status).toBe("blocked");
    expect(unblockActiveStep(restored).active_step_id).toBe("a");
  });
});

it("projects only canonical statuses and the latest matching measured Work attempt", () => {
  const at = "2026-11-24T09:00:00.000Z";
  const graph: WorkDag = {
    id: "graph",
    project_id: "project",
    owner_id: "owner",
    actor_id: "owner",
    version: 4,
    client_request_id: "request",
    title: "Canonical plan",
    mode: "active",
    created_at: at,
    updated_at: at,
    events: [],
    nodes: [
      {
        id: "brief",
        title: "Brief",
        goal: "Prepare a brief",
        depends_on: [],
        status: "completed",
        blocked_reason: null,
        artifacts: [],
        attempts: [
          { number: 1, work_id: "previous", started_at: at, source_artifact_ids: [] },
          { number: 2, work_id: "current", started_at: at, source_artifact_ids: [] }
        ],
        result: {
          stage: "done",
          plan_summary: null,
          plan_instructions: null,
          review: null,
          confirmation_id: null,
          sources: [],
          timing: { work_id: "previous", attempt: 1, queue_ms: 4000, tool_ms: 400 }
        }
      },
      {
        id: "report",
        title: "Report",
        goal: "Prepare a report",
        depends_on: ["brief"],
        status: "running",
        blocked_reason: "EXECUTOR_QUEUE",
        artifacts: [],
        attempts: [{ number: 1, work_id: "next", started_at: at, source_artifact_ids: [] }]
      }
    ]
  };
  const first = projectChatTaskPlan(graph, false);
  expect(first.steps.map((step) => step.status)).toEqual(["completed", "pending"]);
  expect(first.active_step_id).toBeNull();
  expect(planSummary(first).total_ms).toBe(0);
  expect(planSummary(first).measured.size).toBe(0);
  graph.nodes[0]!.result!.timing = {
    work_id: "current",
    attempt: 2,
    queue_ms: 1250,
    tool_ms: 12,
    model_ms: 900,
    pause_ms: 4000,
    await_owner_ms: 15000
  };
  const second = projectChatTaskPlan(graph, true);
  expect(second.collapsed).toBe(true);
  expect(planSummary(second).timing).toEqual({
    queue: 1250,
    tool: 12,
    model: 900,
    pause: 4000,
    await_owner: 15000
  });
  expect(planSummary(second).total_ms).toBe(21162);
  expect(projectChatTaskPlan(graph, true)).toEqual(second);
  graph.nodes[0]!.result!.timing = { work_id: "current", attempt: 2, queue_ms: 0, tool_ms: -1 };
  const immediate = planSummary(projectChatTaskPlan(graph, false));
  expect(immediate.total_ms).toBe(0);
  expect([...immediate.measured]).toEqual(["queue"]);
});
