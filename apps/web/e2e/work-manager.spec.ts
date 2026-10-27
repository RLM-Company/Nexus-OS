import { expect, test } from "@playwright/test";

test("persists scoped memory, shows dependencies and versioned files after reload", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Создай план запуска", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  expect(
    (
      await request.put("/api/v1/projects/" + project.id + "/autonomy-profile", {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).status()
  ).toBe(200);
  await page.goto("/?project=" + project.id + "&view=plan");
  const memory = page.getByRole("region", { name: "Память проекта", exact: true });
  await memory.getByLabel("Название записи").fill("Критерий результата");
  await memory.getByLabel("Содержание записи").fill("Документ должен быть на русском языке");
  await memory.getByRole("button", { name: "Добавить в память", exact: true }).click();
  await expect(memory.getByText("Критерий результата", { exact: true })).toBeVisible();
  await memory.getByRole("button", { name: "Закрепить", exact: true }).click();
  await expect(memory.getByText("Закреплено · Критерий результата", { exact: true })).toBeVisible();
  await page.reload();
  await expect(memory.getByText("Закреплено · Критерий результата", { exact: true })).toBeVisible();
  await memory.getByRole("button", { name: "Изменить", exact: true }).click();
  await memory.getByLabel("Содержание записи").fill("Нужен полный документ");
  await memory.getByRole("button", { name: "Сохранить запись", exact: true }).click();
  await expect(memory.getByText("Нужен полный документ", { exact: true })).toBeVisible();
  const work = page.getByRole("region", { name: "Выполнение задачи Manager", exact: true });
  await work.getByLabel("Задача для выполнения").fill("Создай полный документ с планом запуска");
  await work.getByRole("button", { name: "Создать файлы", exact: true }).click();
  const progress = page.getByRole("region", { name: "Прогресс Work", exact: true });
  await expect(progress.getByText("Завершено этапов: 4 / 4", { exact: true })).toBeVisible();
  await expect(progress.getByRole("list", { name: "Задачи и зависимости" })).toBeVisible();
  const file = progress.getByRole("link", { name: "result.md · версия 1", exact: true });
  await expect(file).toBeVisible();
  const href = await file.getAttribute("href");
  const downloaded = await request.get(href!);
  expect(downloaded.status()).toBe(200);
  expect(downloaded.headers()["content-disposition"]).toContain("attachment");
  expect(await downloaded.text()).toContain("Живая модель не вызывалась");
  await page.reload();
  await expect(file).toHaveAttribute("href", href!);
  await expect(progress.getByText(/Память при принятии: 1 записей/)).toBeVisible();
  await memory.getByRole("button", { name: "Забыть", exact: true }).click();
  await expect(memory.getByText("Закреплено · Критерий результата", { exact: true })).toHaveCount(
    0
  );
  await page.reload();
  await expect(memory.getByText("Записей по запросу нет.", { exact: true })).toBeVisible();
  await expect(file).toBeVisible();
});
