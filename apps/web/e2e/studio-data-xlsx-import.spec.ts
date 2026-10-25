import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strToU8, zipSync, unzipSync, strFromU8 } from "fflate";

const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function workbook() {
  const pieces: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8("<Types/>"),
    "_rels/.rels": strToU8(
      `<Relationships><Relationship Id="a" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    "xl/workbook.xml": strToU8(
      `<workbook xmlns:r="${rel}"><sheets><sheet name="Лист 1" sheetId="1" r:id="one"/><sheet name="Лист 2" sheetId="2" r:id="two"/></sheets></workbook>`
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="one" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="two" Type="${rel}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>wrong</t></is></c></row></sheetData></worksheet>`
    ),
    "xl/worksheets/sheet2.xml": strToU8(
      `<worksheet><sheetData><row r="2"><c r="A2" t="inlineStr"><is><t>id</t></is></c><c r="B2" t="inlineStr"><is><t>amount</t></is></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>ID001</t></is></c><c r="B3"><v>42</v></c></row><row r="5"><c r="A5" t="inlineStr"><is><t>ID002</t></is></c><c r="B5"><f>7+8</f><v>15</v></c></row></sheetData></worksheet>`
    )
  };
  return Buffer.from(zipSync(pieces));
}

test("XLSX: explicit sheet + header selection, editing and roundtrip export without API uploads", async ({
  page
}) => {
  await page.goto("/?surface=files");
  await page.getByRole("button", { name: "Таблицы и диаграммы" }).click();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      !new URL(request.url()).pathname.endsWith("/chat-navigation/import-pins")
    )
      writes.push(request.url());
  });
  await page.getByLabel("Открыть таблицу или сохранённый проект").setInputFiles({
    name: "import.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook()
  });
  await expect(page.getByRole("group", { name: "Параметры импорта XLSX" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Импортировать выбранный лист" })).toBeDisabled();
  await page.getByLabel("Лист XLSX").selectOption("1");
  await page.getByLabel("Строка заголовков XLSX").fill("2");
  await page.getByRole("button", { name: "Импортировать выбранный лист" }).click();
  await expect(page.getByText(/import.xlsx — Лист 2/).first()).toBeVisible();
  await expect(page.getByText(/после фильтра: 3/)).toBeVisible(); // includes sparse row 4
  await expect(page.getByText(/Формулы не вычисляются/)).toBeVisible();
  await page.getByLabel("Тип столбца 2 amount").selectOption("number");
  await page.getByLabel("Редактировать ячейки").check();
  await page.getByRole("button", { name: "Изменить ячейку: строка 1, столбец 2" }).click();
  await page.getByLabel("Новое значение ячейки").fill("47");
  await page.getByRole("button", { name: "Применить ячейку" }).click();
  const saved = page.waitForEvent("download");
  await page.getByRole("button", { name: "Выгрузить Excel", exact: true }).click();
  const file = await saved;
  const xml = strFromU8(
    unzipSync(new Uint8Array(await readFile(await file.path())))["xl/worksheets/sheet1.xml"]!
  );
  expect(xml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">ID001</t>');
  expect(xml).toContain('<c r="B2" t="n"><v>47</v></c>');
  expect(writes).toEqual([]);
});

test("XLSX selection can be discarded and replaced with CSV without a stale import", async ({
  page
}) => {
  await page.goto("/?surface=files");
  await page.getByRole("button", { name: "Таблицы и диаграммы" }).click();
  const input = page.getByLabel("Открыть таблицу или сохранённый проект");
  await input.setInputFiles({
    name: "discard.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: workbook()
  });
  await expect(page.getByRole("group", { name: "Параметры импорта XLSX" })).toBeVisible();
  await page.getByRole("button", { name: "Отменить обработку", exact: true }).click();
  await expect(page.getByRole("group", { name: "Параметры импорта XLSX" })).toHaveCount(0);
  await input.setInputFiles({
    name: "replacement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("id,name\n001,Selected CSV\n")
  });
  await expect(page.getByText(/replacement.csv/).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Selected CSV", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Импортировать выбранный лист", exact: true })
  ).toHaveCount(0);
});
