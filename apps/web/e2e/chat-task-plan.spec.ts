import { expect, test } from "@playwright/test";
import type { WorkDag } from "@cosmora/contracts";

test("the selected project plan survives reload without progressing from chat or replay", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Проект для плана", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = "/api/v1/projects/" + project.id + "/work-dags";
  const planResponse = await request.post(base, {
    data: {
      client_request_id: crypto.randomUUID(),
      title: "Подготовить отчёт по проекту",
      nodes: [
        { id: "brief", title: "Собрать данные", goal: "Подготовь бриф", depends_on: [] },
        { id: "report", title: "Написать отчёт", goal: "Подготовь отчёт", depends_on: ["brief"] }
      ]
    }
  });
  expect(planResponse.status()).toBe(201);
  const plan = (await planResponse.json()) as WorkDag;
  await page.goto(`/?project=${project.id}&view=chat&plan=${plan.id}`);
  const card = page.getByRole("region", { name: "Задачи и план чата" });
  await expect(card).toContainText(plan.title);
  await card.getByRole("button", { name: "Свернуть план" }).click();
  await expect(card.getByText("Собрать данные")).toHaveCount(0);
  await card.getByRole("button", { name: "Развернуть план" }).click();
  await expect(card.locator('[data-status="pending"]')).toHaveCount(2);

  // Even a stale browser event from the old chat timer has no authority.
  await page.evaluate((scope) => {
    for (const type of ["queued", "run.started", "tool.call", "run.completed", "run.completed"])
      window.dispatchEvent(new CustomEvent("kosmora:chat-task-event", { detail: { scope, type } }));
  }, project.id);
  const composer = page.getByLabel("Сообщение менеджеру", { exact: true });
  await composer.fill("Коротко ответь на вопрос об этом проекте");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Ответ получен", { exact: true })).toBeVisible();
  await expect(card.locator('[data-status="pending"]')).toHaveCount(2);
  await expect(card.getByLabel("Время по событиям")).toContainText("инструменты: —");
  await page.reload();
  await expect(card.locator('[data-status="pending"]')).toHaveCount(2);
  const persisted = (await (await request.get(base + "/" + plan.id)).json()) as WorkDag;
  expect(persisted.nodes.map((node) => node.attempts.length)).toEqual([0, 0]);
  expect(persisted.version).toBe(plan.version);

  // Reusing an ID under a different project must never display the selected plan.
  const other = await request.post("/api/v1/projects", {
    data: { initial_message: "Другой проект", client_message_id: crypto.randomUUID() }
  });
  const { project: foreign } = (await other.json()) as { project: { id: string } };
  await page.goto(`/?project=${foreign.id}&view=chat&plan=${plan.id}`);
  await expect(card).toHaveCount(0);
});
