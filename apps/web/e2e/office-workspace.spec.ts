import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
test("file panel saves and reopens a verified DOCX from Drive", async ({ page }, info) => {
  const backups: unknown[] = [];
  await page.route("**/api/v1/storage/drive/backups", async (route) => {
    backups.push(route.request().postDataJSON());
    await route.fulfill(
      backups.length === 1
        ? { status: 502, json: { error: { code: "DRIVE_REQUEST_FAILED" } } }
        : { json: { state: "verified" } }
    );
  });
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
  const saveToDrive = editor.getByRole("button", { name: "Сохранить новую копию на Drive" });
  await expect(saveToDrive).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("office-preview.png"), fullPage: true });
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  await expect(saveToDrive).toBeVisible();
  expect(backups).toHaveLength(0);
  await saveToDrive.click();
  await expect(editor.getByRole("alert")).toContainText("Сохранение на Drive пока не подтверждено");
  await saveToDrive.click();
  await expect(
    editor.getByRole("status").filter({ hasText: "Копия сохранена на Drive" })
  ).toBeVisible();
  await expect(saveToDrive).toHaveCount(0);
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toBeVisible();
  const pending = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  expect(backups).toHaveLength(2);
  expect(backups[1]).toEqual({ ...(backups[0] as object), retry_upload: true });
  expect(backups[0]).toMatchObject({
    chat_ids: [],
    include_results: false,
    office_file: { name: "offer.koswork.docx", bytes: bytes.toString("base64") }
  });
  const xml = strFromU8(unzipSync(bytes)["word/document.xml"]!);
  for (const value of ["19 700", "00123", "07.11.2026", "кроме доставки"])
    expect(xml).toContain(value);
  // The replacement spans existing styled runs, so compare text across tags.
  expect(xml.replace(/<[^>]+>/g, "")).toContain("Компания Б");
  expect(download.suggestedFilename()).toBe("offer.koswork.docx");
  await page.screenshot({ path: info.outputPath("office-copy.png"), fullPage: true });
  const restoredId = randomUUID();
  const version = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  await page.route(`**/api/v1/storage/drive/restored-files/${restoredId}/office`, (route) =>
    route.fulfill({
      json: { name: download.suggestedFilename(), bytes: bytes.toString("base64"), version }
    })
  );
  await page.goto(`/?surface=files&officeRestore=${restoredId}`);
  await expect(editor.getByText(`offer.koswork.docx · ${version}`, { exact: true })).toBeVisible();
  await expect(editor.getByLabel("Адрес", { exact: true })).toBeEnabled();
  await expect(editor.getByText(/Файл новой копии: offer\.koswork\.docx/)).toBeVisible();
  expect(backups).toHaveLength(2);
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

async function prepareWordPlan(page: import("@playwright/test").Page) {
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
  return editor;
}
test("cancelling a delayed preview preserves the queued plan and ignores its late response", async ({
  page
}) => {
  const editor = await prepareWordPlan(page);
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let delayed = true;
  await page.route("**/api/v1/document-workspace/preview", async (route) => {
    if (!delayed) return route.continue();
    delayed = false;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
    await received;
    await editor.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(
      editor.getByRole("list", { name: "План правок" }).getByRole("listitem")
    ).toHaveCount(1);
  } finally {
    release();
  }
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toHaveCount(0);
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
});
for (const corruption of ["bytes", "version"] as const)
  test(`a ${corruption} mismatch cannot become a downloadable verified copy`, async ({ page }) => {
    const editor = await prepareWordPlan(page);
    await page.route("**/api/v1/document-workspace/commit", async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { bytes: string; version: string };
      if (corruption === "bytes") {
        const bytes = Buffer.from(body.bytes, "base64");
        bytes[40] = bytes[40]! ^ 1;
        body.bytes = bytes.toString("base64");
      } else body.version = "sha256:" + "0".repeat(64);
      await route.fulfill({ response, json: body });
    });
    await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
    await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
    await expect(editor.getByRole("alert")).toContainText("Проверка новой копии не пройдена");
    await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  });

test("an empty Word document is shown without offering an invalid text edit", async ({ page }) => {
  const { zipSync, strToU8 } = await import("fflate");
  const parts = unzipSync(await readFile("../../docs/handoff/fixtures/koswork-office/offer.docx"));
  parts["word/document.xml"] = strToU8(
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>'
  );
  await page.goto("/?surface=files");
  const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
  await editor.locator('input[type="file"]').setInputFiles({
    name: "empty.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(zipSync(parts))
  });
  await expect(editor).toContainText("sha256:");
  await expect(editor).toContainText("Нет поддерживаемых текстовых объектов для редактирования");
  await editor.getByLabel("Найти точный текст").fill("Компания А");
  await expect(editor.getByRole("button", { name: "Добавить замену в план" })).toBeDisabled();
  await expect(editor.getByRole("alert")).toHaveCount(0);
});

test("cancelling a delayed commit offers no download and permits a new explicit confirmation", async ({
  page
}) => {
  const editor = await prepareWordPlan(page);
  await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
  const confirm = editor.getByRole("button", { name: "Подтвердить подготовку новой копии" });
  await expect(confirm).toBeVisible();
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let delayed = true;
  await page.route("**/api/v1/document-workspace/commit", async (route) => {
    if (!delayed) return route.continue();
    delayed = false;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await confirm.click();
    await received;
    await editor.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(
      editor.getByRole("list", { name: "План правок" }).getByRole("listitem")
    ).toHaveCount(1);
  } finally {
    release();
  }
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toBeVisible();
});
