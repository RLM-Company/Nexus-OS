import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function openData(page: import("@playwright/test").Page) {
  await page.goto("/?surface=files");
  await page.getByRole("button", { name: "Таблицы и диаграммы" }).click();
  await expect(page.getByRole("heading", { name: "Таблицы и диаграммы" })).toBeVisible();
}

test("Data: actual worker parsing, Russian numbers, line/scatter, complete CSV and injection protection", async ({
  page
}) => {
  let writes = 0;
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
  });
  await openData(page);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "workbench.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(
      'id\tx\ty\nID001\t9\t1 234,50\nID002\t2\t20,5\nID003\t5\t" =2+2"\nID004\t1\t\n'
    )
  });
  await expect(page.getByText("workbench.tsv", { exact: true }).first()).toBeVisible();
  await page.getByRole("combobox", { name: "Тип столбца 2 x" }).selectOption("number");
  await page.getByRole("combobox", { name: "Тип столбца 3 y" }).selectOption("number");
  await page.getByLabel("Числовая колонка").selectOption("2");
  await expect(page.getByText("Чисел", { exact: true }).locator("..")).toContainText("2");
  await expect(page.getByText("Некорректные", { exact: true }).locator("..")).toContainText("1");
  await page.getByLabel("Ось X").selectOption("1");
  await page.getByLabel("Ось Y").selectOption("2");
  await page.getByLabel("Вид").selectOption("scatter");
  await expect(page.getByRole("img", { name: /scatter: x по X, y по Y/ })).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Выгрузить CSV" }).click();
  const file = await downloaded;
  const output = await readFile(await file.path(), "utf8");
  expect(output).toContain("ID001");
  expect(output).toContain("1 234,50");
  expect(output).toContain("' =2+2");
  expect(output.split("\r\n")).toHaveLength(6);
  expect(workers).toHaveLength(1);
  expect(writes).toBe(0);
});

test("Data: workspace is explicit; filtered attachment carries complete rows only", async ({
  page
}) => {
  await openData(page);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "data.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('name,value\nfirst," =2+2"\nsecond,7\n')
  });
  await expect(page.getByText("data.csv", { exact: true }).first()).toBeVisible();
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить workspace JSON" }).click();
  const workspace = await saved;
  expect(workspace.suggestedFilename()).toContain("workspace.json");
  const json = await readFile(await workspace.path());
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "saved.workspace.json",
    mimeType: "application/json",
    buffer: json
  });
  await expect(page.getByText("data.csv", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Добавить фильтр" }).click();
  await page.getByRole("textbox", { name: "Значение фильтра 1" }).fill("first");
  await expect(page.getByText(/после фильтра: 1$/)).toBeVisible();
  await page.getByRole("button", { name: "Подготовить CSV во вложении" }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue(/includedRows=1; truncated=false/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "data-selection.csv"
  );
});

test("Data: worker cancellation during large CSV prevents late results and allows clean re-open", async ({
  page
}) => {
  await openData(page);
  const ten = Array.from({ length: 10 }, (_, i) => `column${i}`).join("\t");
  const large = ten + "\n" + 'ID001\t"quoted\nrow"\t1,5\t2\t3\t4\t5\t6\t7\t8\n'.repeat(79_000);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "large.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(large)
  });
  await page.getByRole("button", { name: "Отменить обработку" }).click();
  await expect(
    page.getByRole("region", { name: "Data Workbench" }).getByRole("alert")
  ).toContainText("Операция отменена");
  await expect(page.getByText("large.tsv", { exact: true })).toHaveCount(0);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "clean.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,value\nworking,1")
  });
  await expect(page.getByText("clean.csv", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("large.tsv", { exact: true })).toHaveCount(0);
});

test("Data: workspace rejects invalid schema and leaves no stale table", async ({ page }) => {
  await openData(page);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "invalid.workspace.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({ schema: "kosmora.studio.data", version: 999, name: "bad" })
    )
  });
  await expect(
    page.getByRole("region", { name: "Data Workbench" }).getByRole("alert")
  ).toContainText("Неизвестная версия");
  await expect(page.getByRole("heading", { name: "Таблица", exact: true })).toHaveCount(0);
});

test("Data: invalid replacement during parsing clears pending state and allows another file", async ({
  page
}) => {
  await openData(page);
  const source = "x,y\n" + "1,2\n".repeat(79_000);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "pending.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(source)
  });
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("unsupported")
  });
  await expect(
    page.getByRole("region", { name: "Data Workbench" }).getByRole("alert")
  ).toContainText("Поддерживаются только CSV");
  await expect(page.getByRole("button", { name: "Отменить обработку" })).toHaveCount(0);
  await expect(page.getByText("pending.csv", { exact: true })).toHaveCount(0);
  await page.getByLabel("Открыть CSV / TSV / workspace JSON").setInputFiles({
    name: "recovered.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("x,y\n1,2")
  });
  await expect(page.getByText("recovered.csv", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Выгрузить CSV" })).toBeEnabled();
});
