import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/** Stage-three "Задачи, план и таймеры в чатах" (owner approved 15 Nov 2026,
 * DEFERRED lifted). Events mirror the real SSE handlers in page.tsx; no model
 * calls and no invented timings — the test emits explicit interval boundaries. */
async function chat(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
    } catch {
      /* Storage may be unavailable; the panel still renders in memory. */
    }
  });
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  return "new-chat";
}

const announce = (page: Page, scope: string) =>
  page.evaluate((scope) => {
    window.dispatchEvent(
      new CustomEvent("kosmora:chat-task-plan", {
        detail: {
          scope,
          id: "plan-1",
          goal: "Подготовить отчёт по проекту",
          steps: [
            { id: "a", title: "Собрать данные" },
            { id: "b", title: "Написать отчёт", depends_on: ["a"] },
            { id: "c", title: "Проверить", depends_on: ["b"] }
          ]
        }
      })
    );
  }, scope);

const event = (page: Page, scope: string, type: string) =>
  page.evaluate(
    ({ scope, type }) => {
      window.dispatchEvent(
        new CustomEvent("kosmora:chat-task-event", {
          detail: { scope, type }
        })
      );
    },
    { scope, type }
  );

const panel = (page: Page) => page.getByRole("region", { name: "Задачи и план чата" });

test("shows goal, active step and status counters with a collapsible plan", async ({ page }) => {
  const scope = await chat(page);
  await announce(page, scope);
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText("Текущая цель");
  await expect(panel(page)).toContainText("Подготовить отчёт по проекту");
  await expect(panel(page)).toContainText(
    "Шагов: 3 · завершено 0 · выполняется 0 · на паузе 0 · ожидает 3 · заблокировано 0"
  );
  await expect(panel(page).getByText("Собрать данные")).toBeVisible();
  await panel(page).getByRole("button", { name: "Свернуть план" }).click();
  await expect(panel(page).getByText("Написать отчёт")).toHaveCount(0);
  await panel(page).getByRole("button", { name: "Развернуть план" }).click();
  await expect(panel(page).getByText("Написать отчёт")).toBeVisible();
});

test("two dependent steps: first completes, second starts automatically, reload keeps progress", async ({
  page
}) => {
  const scope = await chat(page);
  await announce(page, scope);
  await event(page, scope, "run.started");
  await expect(panel(page)).toContainText("активный: Собрать данные");
  await expect(panel(page).locator('[data-status="running"]')).toContainText("Собрать данные");
  await event(page, scope, "message.delta");
  await event(page, scope, "run.completed");
  await expect(panel(page)).toContainText("завершено 1 · выполняется 1 · на паузе 0");
  await expect(panel(page)).toContainText("активный: Написать отчёт");
  await page.reload();
  await expect(panel(page)).toContainText("Подготовить отчёт по проекту");
  await expect(panel(page)).toContainText("завершено 1 · выполняется 1 · на паузе 0");
  await expect(panel(page)).toContainText("активный: Написать отчёт");
  // A completed step is never restarted.
  await event(page, scope, "run.started");
  await expect(panel(page).locator('[data-status="completed"]')).toContainText("Собрать данные");
});

test("timers show only measured model/tool/queue/pause intervals", async ({ page }) => {
  const scope = await chat(page);
  await announce(page, scope);
  await event(page, scope, "run.started");
  await event(page, scope, "tool");
  await event(page, scope, "message.delta");
  await expect(panel(page).getByLabel("Время по событиям")).toBeVisible();
  const timing = panel(page).getByLabel("Время по событиям");
  await expect(timing).toContainText("модель:");
  await expect(timing).toContainText("инструменты:");
  // No fabricated reasoning time: unmeasured kinds stay as an em dash.
  await expect(timing).toContainText("очередь: —");
});

test("failure blocks the active step without losing completed progress", async ({ page }) => {
  const scope = await chat(page);
  await announce(page, scope);
  await event(page, scope, "run.started");
  await event(page, scope, "run.failed");
  await expect(panel(page)).toContainText("заблокировано 1");
  await expect(panel(page)).not.toContainText("активный:");
});

test("pause, permission gate and resume stay distinct through a reload", async ({ page }) => {
  const scope = await chat(page);
  await announce(page, scope);
  await event(page, scope, "run.started");
  await event(page, scope, "pause");
  await expect(panel(page)).toContainText("на паузе 1 · ожидает 2 · заблокировано 0");
  await expect(panel(page).locator('[data-status="paused"]')).toContainText(
    "на паузе (пауза владельца)"
  );
  await page.reload();
  await expect(panel(page)).toContainText("на паузе 1 · ожидает 2 · заблокировано 0");
  await event(page, scope, "resume");
  await expect(panel(page).locator('[data-status="running"]')).toContainText("Собрать данные");
  await event(page, scope, "permission");
  await expect(panel(page).locator('[data-status="blocked"]')).toContainText(
    "заблокирован (ожидает разрешения)"
  );
  // A pause resume must not clear a permission gate.
  await event(page, scope, "resume");
  await expect(panel(page).locator('[data-status="blocked"]')).toContainText(
    "заблокирован (ожидает разрешения)"
  );
  await event(page, scope, "approval");
  await expect(panel(page).locator('[data-status="running"]')).toContainText("Собрать данные");
});

test("clarification answer closes the owner gate and the next step starts once", async ({
  page
}) => {
  const scope = await chat(page);
  await announce(page, scope);
  await event(page, scope, "run.started");
  await event(page, scope, "await_owner");
  // The card is mounted in a project chat; this scenario drives the plan events
  // emitted by its onResolved callback (option answer or skip).
  await event(page, scope, "approval");
  await event(page, scope, "run.completed");
  await expect(panel(page)).toContainText("активный: Написать отчёт");
  await expect(panel(page).locator('[data-status="running"]')).toHaveCount(1);
  await event(page, scope, "run.started");
  await expect(panel(page).locator('[data-status="running"]')).toHaveCount(1);
  await expect(panel(page)).toContainText("активный: Написать отчёт");
});

test("a plan from another chat scope is never shown", async ({ page }) => {
  await chat(page);
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("kosmora:chat-task-plan", {
        detail: {
          scope: "other-chat",
          id: "foreign",
          goal: "Чужая цель",
          steps: [{ id: "x", title: "Чужой шаг" }]
        }
      })
    );
  });
  await expect(panel(page)).toHaveCount(0);
});
