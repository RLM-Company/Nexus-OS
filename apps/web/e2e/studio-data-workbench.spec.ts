import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

async function openData(page: import("@playwright/test").Page) {
  await page.goto("/?surface=files");
  await page.getByRole("button", { name: "Таблицы и диаграммы" }).click();
  await expect(page.getByRole("heading", { name: "Таблицы и диаграммы" })).toBeVisible();
}

test("Data exports an actual Excel workbook with all sorted rows and typed values without an API write", async ({
  page
}) => {
  await openData(page);
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "excel.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(
      "id\tamount\tformula\n" +
        Array.from({ length: 180 }, (_, i) => `${String(i).padStart(4, "0")}\t${i},5\t=1+1`).join(
          "\n"
        )
    )
  });
  await page.getByLabel("Тип столбца 2 amount").selectOption("number");
  await page.getByLabel("Сортировать по").selectOption("1");
  await page.getByLabel("Направление").selectOption("desc");
  await expect(page.getByText(/после фильтра: 180$/)).toBeVisible();
  const ready = page.waitForEvent("download");
  await page.getByRole("button", { name: "Выгрузить Excel", exact: true }).click();
  const file = await ready;
  expect(file.suggestedFilename()).toBe("excel.tsv-filtered.xlsx");
  const xml = strFromU8(
    unzipSync(new Uint8Array(await readFile(await file.path())))["xl/worksheets/sheet1.xml"]!
  );
  expect(xml.match(/<row /g)).toHaveLength(181);
  expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">0179</t>');
  expect(xml).toContain('<c r="B2" t="n"><v>179.5</v></c>');
  expect(xml).toContain('<c r="B181" t="n"><v>0.5</v></c>');
  expect(xml).toContain('xml:space="preserve">=1+1</t>');
  expect(xml).not.toContain("<f>");
  await expect(page.getByText(/Экспортировано 180 полных строк/)).toBeVisible();
  expect(writes).toEqual([]);
});

test("Data edits source rows under sorting, supports undo/redo and retains edits across tabs and workspace export", async ({
  page
}) => {
  await openData(page);
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "editable.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,value\nA,9\nB,2\nC,5")
  });
  await page.getByLabel("Тип столбца 2 value").selectOption("number");
  await page.getByLabel("Числовая колонка").selectOption("1");
  await page.getByLabel("Сортировать по").selectOption("1");
  await page.getByRole("button", { name: "Добавить фильтр" }).click();
  await page.getByLabel("Столбец фильтра 1").selectOption("1");
  await page.getByLabel("Условие фильтра 1").selectOption("greater");
  await page.getByLabel("Значение фильтра 1").fill("3");
  await expect(page.getByText(/после фильтра: 2$/)).toBeVisible();
  await page.getByLabel("Редактировать ячейки").check();
  const cell = page.getByRole("button", {
    name: "Изменить ячейку: строка 3, столбец 2",
    exact: true
  });
  await cell.click();
  await page.getByLabel("Новое значение ячейки").fill("12,5");
  await page.getByRole("button", { name: "Применить ячейку", exact: true }).click();
  await expect(cell).toHaveText("12,5");
  await expect(page.getByText("Сумма", { exact: true }).locator("..")).toContainText("21,5");
  await page.getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(cell).toHaveText("5");
  await page.getByRole("button", { name: "Повторить правку", exact: true }).click();
  await expect(cell).toHaveText("12,5");
  await page.getByRole("button", { name: "Документы и текст", exact: true }).click();
  await page.getByRole("button", { name: "Таблицы и диаграммы", exact: true }).click();
  await expect(cell).toHaveText("12,5");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Сохранить workspace JSON", exact: true }).click();
  const file = await saving;
  const bytes = await readFile(await file.path());
  const stored = JSON.parse(bytes.toString("utf8"));
  expect(stored.table.rows).toEqual([
    ["A", "9"],
    ["B", "2"],
    ["C", "12,5"]
  ]);
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "edited.workspace.json",
    mimeType: "application/json",
    buffer: bytes
  });
  await expect(cell).toHaveText("12,5");
  await expect(page.getByRole("button", { name: "Отменить правку", exact: true })).toBeDisabled();
});

test("Data: actual worker parsing, Russian numbers, line/scatter, complete CSV and injection protection", async ({
  page
}) => {
  let writes = 0;
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("request", (request) => {
    // Initial navigation may migrate existing browser pins. Data itself must stay local.
    if (
      request.method() === "POST" &&
      !new URL(request.url()).pathname.endsWith("/chat-navigation/import-pins")
    )
      writes++;
  });
  await openData(page);
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
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
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
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
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
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
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "large.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(large)
  });
  await page.getByRole("button", { name: "Отменить обработку" }).click();
  await expect(
    page.getByRole("region", { name: "Data Workbench" }).getByRole("alert")
  ).toContainText("Операция отменена");
  await expect(page.getByText("large.tsv", { exact: true })).toHaveCount(0);
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "clean.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,value\nworking,1")
  });
  await expect(page.getByText("clean.csv", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("large.tsv", { exact: true })).toHaveCount(0);
});

test("Data: workspace rejects invalid schema and leaves no stale table", async ({ page }) => {
  await openData(page);
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
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
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "pending.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(source)
  });
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("unsupported")
  });
  await expect(
    page.getByRole("region", { name: "Data Workbench" }).getByRole("alert")
  ).toContainText("Поддерживаются CSV, TSV, XLSX и workspace JSON.");
  await expect(page.getByRole("button", { name: "Отменить обработку" })).toHaveCount(0);
  await expect(page.getByText("pending.csv", { exact: true })).toHaveCount(0);
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "recovered.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("x,y\n1,2")
  });
  await expect(page.getByText("recovered.csv", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Выгрузить CSV" })).toBeEnabled();
});
