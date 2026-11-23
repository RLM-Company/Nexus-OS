/** Локальный сквозной прогон чистого автомата плана без vitest.
 * Node 24 запускает .ts напрямую (strip-types); assertions из node:assert. */
import assert from "node:assert/strict";
import {
  blockActiveStep,
  chatTaskPlanKey,
  completeStep,
  createChatTaskPlan,
  failStep,
  pauseActiveStep,
  planSummary,
  readChatTaskPlan,
  recordInterval,
  resumeActiveStep,
  saveChatTaskPlan,
  startStep,
  unblockActiveStep
} from "../../apps/web/src/app/chat-task-plan.ts";

class MemoryStorage {
  values = new Map();
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

const base = {
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

const results = [];
const check = (name, fn) => {
  fn();
  results.push(name);
};

check("очередь → планирование → выполнение", () => {
  let plan = createChatTaskPlan(base);
  assert.equal(plan.active_step_id, null);
  assert.equal(planSummary(plan).pending, 3);
  assert.equal(startStep(plan, "b", 1050), plan, "зависимый шаг не должен стартовать");
  plan = startStep(plan, "a", 1100);
  assert.equal(plan.active_step_id, "a");
  assert.equal(planSummary(plan).running, 1);
});

check("пауза отделена от ошибки и разрешения", () => {
  let plan = startStep(createChatTaskPlan(base), "a", 1000);
  plan = pauseActiveStep(plan);
  assert.equal(plan.steps[0].status, "paused");
  assert.equal(plan.steps[0].block_reason, "owner_pause");
  const restored = plan; // в реальности это localStorage
  plan = resumeActiveStep(restored);
  assert.equal(plan.steps[0].status, "running");
  let gated = blockActiveStep(
    startStep(createChatTaskPlan(base), "a", 1000),
    "awaiting_permission"
  );
  assert.equal(resumeActiveStep(gated).steps[0].status, "blocked");
  assert.equal(unblockActiveStep(gated).steps[0].status, "running");
});

check("подхват следующего шага один раз с started_at", () => {
  const started = startStep(createChatTaskPlan(base), "a", 1000);
  const done = completeStep(started, "a", 1500);
  assert.equal(done.steps[0].status, "completed");
  assert.equal(done.steps[1].status, "running");
  assert.equal(done.steps[1].started_at, 1500);
  assert.equal(startStep(done, "b", 1600), done, "повторный старт не разрешён");
  assert.equal(started.steps[0].status, "running", "старый снимок не изменён");
  assert.equal(started.steps[1].status, "pending", "старый снимок не изменён");
});

check("разные таймеры и честное отсутствие данных", () => {
  let plan = startStep(createChatTaskPlan(base), "a", 1000);
  plan = recordInterval(plan, "model", 1000, 1300);
  plan = recordInterval(plan, "tool", 1300, 1450);
  plan = recordInterval(plan, "queue", 1450, 1500);
  plan = recordInterval(plan, "pause", 1500, 1600);
  plan = recordInterval(plan, "await_owner", 1600, 1800);
  assert.deepEqual(planSummary(plan).timing, {
    model: 300,
    tool: 150,
    queue: 50,
    pause: 100,
    await_owner: 200
  });
  assert.equal(planSummary(plan).total_ms, 800);
});

check("уточнение: свободный ответ и пропуск не ломают план", () => {
  let plan = startStep(createChatTaskPlan(base), "a", 1000);
  plan = blockActiveStep(plan, "awaiting_permission");
  plan = recordInterval(plan, "await_owner", 1000, 1250);
  plan = unblockActiveStep(plan);
  assert.equal(plan.steps[0].status, "running");
  assert.equal(planSummary(plan).timing.await_owner, 250);
});

check("ошибка и отмена закрывают шаг", () => {
  const plan = startStep(createChatTaskPlan(base), "a", 1000);
  const failed = failStep(plan, "a", 1200, "failed");
  assert.equal(failed.active_step_id, null);
  assert.equal(failed.steps[0].block_reason, "failed");
  const cancelled = failStep(plan, "a", 1200, "cancelled");
  assert.equal(cancelled.steps[0].block_reason, "cancelled");
});

check("перезагрузка сохраняет цель, шаг и состояние уточнения", () => {
  const storage = new MemoryStorage();
  let plan = startStep(createChatTaskPlan(base), "a", 1000);
  plan = blockActiveStep(plan, "awaiting_permission");
  plan = recordInterval(plan, "await_owner", 1000, 1250);
  saveChatTaskPlan(storage, plan);
  assert.ok(storage.values.has(chatTaskPlanKey("chat-a")));
  const restored = readChatTaskPlan(storage, "chat-a");
  assert.equal(restored.goal, base.goal);
  assert.equal(restored.active_step_id, "a");
  assert.equal(restored.steps[0].block_reason, "awaiting_permission");
  assert.equal(planSummary(restored).timing.await_owner, 250);
});

check("ветвление зависимостей: по одному доступному шагу", () => {
  const branched = createChatTaskPlan({
    ...base,
    steps: [
      { id: "a", title: "A" },
      { id: "b", title: "B", depends_on: ["a"] },
      { id: "c", title: "C", depends_on: ["a"] },
      { id: "d", title: "D", depends_on: ["b", "c"] }
    ]
  });
  let plan = startStep(branched, "a", 1000);
  plan = completeStep(plan, "a", 1200);
  assert.equal(plan.active_step_id, "b");
  assert.equal(plan.steps.filter((s) => s.status === "running").length, 1);
  plan = completeStep(plan, "b", 1400);
  assert.equal(plan.active_step_id, "c");
  plan = completeStep(plan, "c", 1600);
  assert.equal(plan.active_step_id, "d");
  assert.equal(planSummary(plan).completed, 3);
});

for (const name of results) console.log("  ok  " + name);
console.log("ALL " + results.length + " checks passed");
