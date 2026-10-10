import { expect, test } from "@playwright/test";
import type { WorkDag } from "@cosmora/contracts";

test("owner creates, edits and executes a dependency plan with durable versioned files", async ({
  page,
  request
}) => {
  const response = await request.post("/api/v1/projects", {
    data: { initial_message: "План с зависимостями", client_message_id: crypto.randomUUID() }
  });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };
  expect(
    (
      await request.put("/api/v1/projects/" + project.id + "/autonomy-profile", {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).status()
  ).toBe(200);
  await page.goto("/?project=" + project.id + "&view=plan");
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByRole("button", { name: "Новый план", exact: true }).click();
  await panel.getByLabel("Название плана", { exact: true }).fill("Документ по брифу");
  const first = panel.getByRole("group", { name: "Шаг 1", exact: true });
  await first.getByLabel("Название", { exact: true }).fill("Бриф");
  await first.getByRole("textbox", { name: "Задача для Manager", exact: true }).fill("Создай бриф");
  await panel.getByRole("button", { name: "Добавить шаг", exact: true }).click();
  const second = panel.getByRole("group", { name: "Шаг 2", exact: true });
  await second.getByLabel("Название", { exact: true }).fill("Документ");
  await second
    .getByRole("textbox", { name: "Задача для Manager", exact: true })
    .fill("Создай документ на основе брифа");
  await second.getByLabel("Бриф", { exact: true }).check();
  await panel.getByRole("button", { name: "Сохранить план", exact: true }).click();
  await expect(panel.getByText("Ожидает: Бриф", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", { name: "Редактировать не запущенные шаги", exact: true })
    .click();
  await panel
    .getByRole("group", { name: "Шаг 2", exact: true })
    .getByRole("textbox", { name: "Задача для Manager", exact: true })
    .fill("Создай полный документ на основе брифа");
  await panel.getByRole("button", { name: "Сохранить план", exact: true }).click();
  await panel.getByRole("button", { name: "Запустить шаг", exact: true }).click();
  const versionOne = panel.getByRole("link", { name: "result.md · версия 1", exact: true });
  await expect(versionOne).toBeVisible();
  await expect(panel.getByRole("button", { name: "Запустить шаг", exact: true })).toHaveCount(1);
  await page.reload();
  await expect(versionOne).toBeVisible();
  await panel.getByRole("button", { name: "Приостановить проект", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Продолжить проект", exact: true })).toBeVisible();
  await page.reload();
  await panel.getByRole("button", { name: "Продолжить проект", exact: true }).click();
  await panel.getByRole("button", { name: "Запустить шаг", exact: true }).click();
  const versionTwo = panel.getByRole("link", { name: "result.md · версия 2", exact: true });
  await expect(versionTwo).toBeVisible();
  const file = await request.get((await versionTwo.getAttribute("href"))!);
  expect(file.status()).toBe(200);
  expect(await file.text()).toContain("Живая модель не вызывалась");
  const list = (await (
    await request.get("/api/v1/projects/" + project.id + "/work-dags")
  ).json()) as { items: WorkDag[] };
  expect(list.items[0]!.nodes.map((n) => n.status)).toEqual(["completed", "completed"]);
  expect(list.items[0]!.nodes.map((n) => n.attempts.length)).toEqual([1, 1]);
  expect(list.items[0]!.nodes[1]!.attempts[0]!.source_artifact_ids).toHaveLength(1);
  await panel.getByRole("button", { name: "Отменить работы проекта", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Продолжить проект", exact: true })).toHaveCount(
    0
  );
  await expect(versionOne).toBeVisible();
  await expect(versionTwo).toBeVisible();
});
