import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import type { WorkDag } from "@cosmora/contracts";

test("Work edits, filters and reloads priorities and local deadlines without execution", async ({
  page,
  request
}) => {
  const project = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Work schedule " + randomUUID().slice(0, 8),
      client_message_id: randomUUID()
    }
  });
  expect(project.status()).toBe(201);
  const id = (await project.json()).project.id as string;
  const base = `/api/v1/projects/${id}/work-dags`;
  const created = await request.post(base, {
    data: {
      client_request_id: randomUUID(),
      title: "Сроки и приоритеты",
      nodes: [
        {
          id: "late",
          title: "Просроченный бриф",
          goal: "Написать бриф",
          depends_on: [],
          priority: "high",
          deadline: "2020-01-01T12:00:00Z"
        },
        { id: "later", title: "Документ", goal: "Подготовить документ", depends_on: ["late"] }
      ]
    }
  });
  expect(created.status()).toBe(201);
  const source = (await created.json()) as WorkDag;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await expect(panel.getByText(/Срок прошёл/)).toBeVisible();
  await panel.getByLabel("Сроки шагов", { exact: true }).selectOption("overdue");
  await expect(
    panel.getByText("Просроченный бриф · Готов к запуску", { exact: true })
  ).toBeVisible();
  await expect(panel.getByText("Документ · Заблокирован", { exact: true })).toHaveCount(0);
  await panel.getByLabel("Сроки шагов", { exact: true }).selectOption("none");
  await expect(panel.getByText("Документ · Заблокирован", { exact: true })).toBeVisible();
  await panel.getByLabel("Сроки шагов", { exact: true }).selectOption("all");
  await panel
    .getByRole("button", { name: "Редактировать не запущенные шаги", exact: true })
    .click();
  await panel.getByLabel("Приоритет шага 2", { exact: true }).selectOption("urgent");
  await panel.getByLabel("Срок шага 2", { exact: true }).fill("2028-02-29T15:30");
  await panel.getByRole("button", { name: "Убрать срок шага 1", exact: true }).click();
  await panel.getByRole("button", { name: "Сохранить план", exact: true }).click();
  await expect(panel.getByLabel("Приоритет шага 2", { exact: true })).toHaveCount(0);
  await page.reload();
  await panel
    .getByRole("button", { name: "Редактировать не запущенные шаги", exact: true })
    .click();
  await expect(panel.getByLabel("Приоритет шага 2", { exact: true })).toHaveValue("urgent");
  await expect(panel.getByLabel("Срок шага 2", { exact: true })).toHaveValue("2028-02-29T15:30");
  await expect(panel.getByLabel("Срок шага 1", { exact: true })).toHaveValue("");
  const saved = (await (await request.get(`${base}/${source.id}`)).json()) as WorkDag;
  expect(saved.nodes[0]!.deadline).toBeNull();
  expect(saved.nodes[1]!.priority).toBe("urgent");
  expect(saved.nodes[1]!.deadline).toMatch(/^2028-02-29T/);
  expect(saved.nodes.every((node) => !node.attempts.length)).toBe(true);
  expect(saved.execution).toBeUndefined();
});
