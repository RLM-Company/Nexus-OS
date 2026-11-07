import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
test("file panel opens DOCX, previews an edit and downloads the verified copy after confirmation", async ({
  page
}, info) => {
  await page.goto("/?surface=files");
  const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
  await editor
    .locator('input[type="file"]')
    .setInputFiles("../../docs/handoff/fixtures/koswork-office/offer.docx");
  await expect(editor).toContainText("sha256:");
  await editor.getByLabel("Адрес", { exact: true }).selectOption("paragraph:3");
  await editor.getByLabel("Найти точный текст").fill("Компания А");
  await editor.getByLabel("Заменить на").fill("Компания Б");
  await editor.getByRole("button", { name: "Добавить замену в план" }).click();
  await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("office-preview.png"), fullPage: true });
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toBeVisible();
  const pending = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
  for (const value of ["19 700", "00123", "07.11.2026", "кроме доставки"])
    expect(xml).toContain(value);
  // The replacement spans existing styled runs, so compare text across tags.
  expect(xml.replace(/<[^>]+>/g, "")).toContain("Компания Б");
  expect(download.suggestedFilename()).toBe("offer.koswork.docx");
  await page.screenshot({ path: info.outputPath("office-copy.png"), fullPage: true });
});
for (const format of ["xlsx", "pptx"] as const)
  test(`file panel edits and exports ${format} bytes`, async ({ page }) => {
    await page.goto("/?surface=files");
    const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
    await editor
      .locator('input[type="file"]')
      .setInputFiles(`../../docs/handoff/fixtures/koswork-office/offer.${format}`);
    await expect(editor).toContainText("sha256:");
    if (format === "xlsx") {
      await editor.getByLabel("Новый лист").fill("Итог");
      await editor.getByRole("button", { name: "Добавить лист в план" }).click();
      await editor.getByLabel("Адрес", { exact: true }).selectOption("sheet:2");
      await editor.getByLabel("Значение", { exact: true }).fill("00123");
      await editor.getByRole("button", { name: "Добавить правку ячейки" }).click();
      await editor.getByLabel("Ячейка", { exact: true }).fill("B1");
      await editor.getByLabel("Тип", { exact: true }).selectOption("number");
      await editor.getByLabel("Значение", { exact: true }).fill("19700");
      await editor.getByRole("button", { name: "Добавить правку ячейки" }).click();
      await editor.getByLabel("Ячейка", { exact: true }).fill("B2");
      await editor.getByLabel("Тип", { exact: true }).selectOption("formula");
      await editor.getByLabel("Значение", { exact: true }).fill("SUM(B1:B1)");
      await editor.getByRole("button", { name: "Добавить правку ячейки" }).click();
      await editor.getByLabel("Ячейка", { exact: true }).fill("C1");
      await editor.getByLabel("Тип", { exact: true }).selectOption("boolean");
      await editor.getByLabel("Значение", { exact: true }).fill("true");
      await editor.getByRole("button", { name: "Добавить правку ячейки" }).click();
    } else {
      await editor.getByLabel("Адрес", { exact: true }).selectOption("slide:1/shape:2");
      await editor.getByLabel("Найти точный текст").fill("Компания А");
      await editor.getByLabel("Заменить на").fill("Компания Б");
      await editor.getByRole("button", { name: "Добавить замену в план" }).click();
    }
    await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
    await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
    await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
    await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toBeVisible();
    const pending = page.waitForEvent("download");
    await editor.getByRole("link", { name: "Скачать новую копию" }).click();
    const downloaded = await pending;
    const parts = unzipSync(await readFile((await downloaded.path())!));
    if (format === "xlsx") {
      const sheet = strFromU8(parts["xl/worksheets/sheet2.xml"]!);
      expect(sheet).toContain("00123");
      expect(sheet).toMatch(/<c r="C1" t="b"><v>1<\/v><\/c>/);
      expect(sheet).toContain("<f>SUM(B1:B1)</f>");
      expect(sheet).toMatch(/<c r="B2"><f>SUM\(B1:B1\)<\/f><\/c>/);
    } else {
      expect(strFromU8(parts["ppt/slides/slide1.xml"]!)).toContain("Компания Б");
      expect(strFromU8(parts["ppt/slides/slide2.xml"]!)).toContain("Без правок");
    }
  });

test("file panel pages a large DOCX and edits its last paragraph without losing earlier pages", async ({
  page
}, info) => {
  test.setTimeout(60000);
  const require = createRequire(resolve(process.cwd(), "package.json"));
  const { pagedWord } = require(
    resolve(process.cwd(), "../../desktop/windows/test/fixtures/office-paged-brief.cjs")
  ) as {
    pagedWord: (options: { paragraphs: number; long: boolean }) => {
      buffer: Buffer;
      texts: string[];
    };
  };
  const source = pagedWord({ paragraphs: 330, long: true });
  await page.goto("/?surface=files");
  const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
  await editor.locator('input[type="file"]').setInputFiles({
    name: "large.DOCX",
    mimeType: "application/octet-stream",
    buffer: source.buffer
  });
  const navigation = editor.getByRole("navigation", { name: "Страницы Office" });
  await expect(navigation).toContainText("Часть 1.");
  const next = navigation.getByRole("button", { name: "Следующая часть" });
  let part = 1;
  while (await next.isEnabled()) {
    expect(part).toBeLessThan(100);
    await next.click();
    part++;
    await expect(navigation).toContainText(`Часть ${part}.`);
  }
  expect(part).toBeGreaterThan(2);
  await navigation.getByRole("button", { name: "Предыдущая часть" }).click();
  await expect(navigation).toContainText(`Часть ${part - 1}.`);
  await next.click();
  await expect(navigation).toContainText(`Часть ${part}.`);
  await editor.getByText("Содержимое и адреса", { exact: true }).click();
  await navigation.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("office-paged-view.png"), fullPage: true });
  await editor.getByLabel("Адрес", { exact: true }).selectOption("paragraph:331");
  await editor.getByLabel("Найти точный текст").fill("Раздел 330");
  await editor.getByLabel("Заменить на").fill("Готово 330");
  await editor.getByRole("button", { name: "Добавить замену в план" }).click();
  await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toBeVisible();
  const pending = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const file = await pending,
    bytes = await readFile((await file.path())!);
  const text = strFromU8(unzipSync(bytes)["word/document.xml"]!).replace(/<[^>]+>/g, "");
  expect(text).toContain("Готово 330");
  expect(text).toContain("Раздел 1:");
  expect(text).toContain("00123");
  expect(text).toContain("кроме доставки");
});
