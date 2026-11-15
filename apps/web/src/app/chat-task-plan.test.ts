import { describe, expect, it } from "vitest";
import {
  chatTaskPlanKey,
  clearChatTaskPlan,
  completeStep,
  createChatTaskPlan,
  failStep,
  formatDuration,
  nextReadyStep,
  pauseActiveStep,
  planSummary,
  readChatTaskPlan,
  recordInterval,
  resumeActiveStep,
  saveChatTaskPlan,
  startStep,
  toggleCollapsed
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

  it("collapses and manages pause/resume/failure without losing progress", () => {
    let plan = startStep(createChatTaskPlan(input), "a", 1000);
    plan = toggleCollapsed(plan);
    expect(plan.collapsed).toBe(true);
    plan = pauseActiveStep(plan);
    expect(plan.steps[0]!.status).toBe("blocked");
    plan = resumeActiveStep(plan);
    expect(plan.steps[0]!.status).toBe("running");
    plan = failStep(plan, "a", 1500);
    expect(plan.active_step_id).toBeNull();
    expect(plan.steps[0]!.status).toBe("blocked");
    expect(planSummary(plan).blocked).toBeGreaterThan(0);
  });
});
