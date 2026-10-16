import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

test("Project tables survive a lost save response, conflicts, reload and restore; reports open in Canvas", async ({
  page,
  request
}) => {
  test.setTimeout(70_000);
  const projectId = randomUUID();
  expect(
    (
      await request.post("/api/v1/projects/empty", {
        data: { client_project_id: projectId, title: "Saved tables" }
      })
    ).ok()
  ).toBe(true);
  const base = `/api/v1/projects/${projectId}/tables`;
  let posts = 0,
    lost = false;
  await page.route("**/tables", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      if (!lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.ok()).toBe(true);
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page.goto(`/?project=${projectId}&surface=files`);
  await page.getByRole("button", { name: "Таблицы и диаграммы", exact: true }).click();
  const panel = page.getByRole("region", { name: "Таблицы проекта", exact: true });
  await page
    .getByLabel("Открыть таблицу или сохранённый проект")
    .setInputFiles({
      name: "sales.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,value\nA,5\nB,9")
    });
  await page.getByLabel("Тип столбца 2 value").selectOption("number");
  await page.getByLabel("Числовая колонка").selectOption("1");
  await panel.getByRole("button", { name: "Сохранить в проекте", exact: true }).click();
  await expect(panel).toContainText("Сохранено в проекте: sales.csv, версия 1");
  expect(posts).toBe(1);
  let items = (await (await request.get(base)).json()).items;
  expect(items).toHaveLength(1);
  const id = items[0].id;
  await page.getByLabel("Редактировать ячейки").check();
  const cell = page.getByRole("button", {
    name: "Изменить ячейку: строка 1, столбец 2",
    exact: true
  });
  await cell.click();
  await page.getByLabel("Новое значение ячейки").fill("7");
  await page.getByRole("button", { name: "Применить ячейку", exact: true }).click();
  await expect(cell).toHaveText("7");
  await panel.getByRole("button", { name: "Сохранить в проекте", exact: true }).click();
  await expect(panel).toContainText("версия 2");
  const current = await (await request.get(`${base}/${id}`)).json();
  const external = JSON.parse(current.revision.content);
  external.table.rows[0][1] = "11";
  expect(
    (
      await request.put(`${base}/${id}`, {
        data: { title: "sales.csv", baseVersion: 2, content: JSON.stringify(external) }
      })
    ).ok()
  ).toBe(true);
  await cell.click();
  await page.getByLabel("Новое значение ячейки").fill("8");
  await page.getByRole("button", { name: "Применить ячейку", exact: true }).click();
  await panel.getByRole("button", { name: "Сохранить в проекте", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("уже версия 3");
  await expect(cell).toHaveText("8");
  await panel.getByRole("button", { name: "Сохранить таблицу как копию", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  items = (await (await request.get(base)).json()).items;
  expect(items).toHaveLength(2);
  const copy = items.find((item: { id: string }) => item.id !== id);
  expect(
    JSON.parse((await (await request.get(`${base}/${copy.id}`)).json()).revision.content).table
      .rows[0][1]
  ).toBe("8");
  await page.reload();
  await page.getByRole("button", { name: "Таблицы и диаграммы", exact: true }).click();
  await panel.getByLabel("Сохранённые таблицы").selectOption(id);
  await panel.getByRole("button", { name: "Открыть таблицу проекта", exact: true }).click();
  await page.getByLabel("Редактировать ячейки").check();
  await expect(cell).toHaveText("11");
  await panel.getByLabel("История таблицы").selectOption("1");
  page.once("dialog", (dialog) => dialog.accept());
  await panel
    .getByRole("button", { name: "Восстановить таблицу новой версией", exact: true })
    .click();
  await expect(panel).toContainText("Восстановлено новой версией 4");
  await expect(cell).toHaveText("5");
  await panel.getByRole("button", { name: "Редактировать отчёт в Canvas", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  await expect(canvas.getByLabel("Содержимое", { exact: true })).toHaveValue(/sales.csv/);
  const report = await canvas.getByLabel("Содержимое", { exact: true }).inputValue();
  await canvas
    .getByLabel("Содержимое", { exact: true })
    .fill(report + "\n\nПроверенная редакторская правка.");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  const downloading = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать DOCX", exact: true }).click();
  const file = await downloading;
  const bytes = await readFile(await file.path());
  expect(strFromU8(unzipSync(bytes)["word/document.xml"]!)).toContain(
    "Проверенная редакторская правка."
  );
  const revisions = await (await request.get(`${base}/${id}/revisions`)).json();
  expect(revisions.items).toHaveLength(4);
});

test("Saving a local table without a project creates a project without discarding the open data", async ({
  page,
  request
}) => {
  await page.goto("/?surface=files");
  await page.getByRole("button", { name: "Таблицы и диаграммы", exact: true }).click();
  await page
    .getByLabel("Открыть таблицу или сохранённый проект")
    .setInputFiles({
      name: "local.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("id,value\nKEEP,123")
    });
  const panel = page.getByRole("region", { name: "Таблицы проекта", exact: true });
  await panel.getByRole("button", { name: "Сохранить в проекте", exact: true }).click();
  await expect(panel).toContainText("Сохранено в проекте: local.csv, версия 1");
  await expect(page.getByRole("cell", { name: "KEEP", exact: true })).toBeVisible();
  const projects = await (await request.get("/api/v1/projects")).json();
  const project = projects.items.find((item: { title: string }) => item.title === "Таблицы Studio");
  expect(project).toBeTruthy();
  const list = await (await request.get(`/api/v1/projects/${project.id}/tables`)).json();
  expect(list.items).toHaveLength(1);
});
