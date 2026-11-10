import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page, type Locator, type APIRequestContext } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";
type Brief = {
  company: string;
  price: string;
  sheet: string;
  amount: string;
  date: string;
  tsv: string;
};
const brief = async () =>
  JSON.parse(
    await readFile("../../docs/handoff/fixtures/koswork-office-plan-edit/input.json", "utf8")
  ) as Brief;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const modelRequests = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});
async function open(page: Page, format: string) {
  const posts: string[] = [];
  modelRequests.set(page, posts);
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/v1\/(?:chats|projects)(?:\/[^/]+\/(?:messages|work))?$/.test(
        new URL(r.url()).pathname
      )
    )
      posts.push(r.url());
  });
  await page.goto("/?surface=files");
  const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
  await editor
    .locator('input[type="file"]')
    .setInputFiles(`../../docs/handoff/fixtures/koswork-office/offer.${format}`);
  await expect(editor).toContainText("sha256:");
  return editor;
}
async function textEdit(editor: Locator, target: string, find: string, replace: string) {
  await editor.getByLabel("Адрес", { exact: true }).selectOption(target);
  await editor.getByLabel("Найти точный текст", { exact: true }).fill(find);
  await editor.getByLabel("Заменить на", { exact: true }).fill(replace);
  await editor.getByRole("button", { name: "Добавить замену в план", exact: true }).click();
}
async function preview(page: Page, editor: Locator) {
  const pending = page.waitForResponse((r) => r.url().endsWith("/document-workspace/preview"));
  await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(
    editor.getByRole("heading", { name: "Предлагаемые изменения", exact: true })
  ).toBeVisible();
  return response;
}
async function save(page: Page, editor: Locator, request: APIRequestContext, format: string) {
  const source = await readFile(`../../docs/handoff/fixtures/koswork-office/offer.${format}`);
  const pendingResponse = page.waitForResponse((r) =>
    r.url().endsWith("/document-workspace/commit")
  );
  await editor
    .getByRole("button", { name: "Подтвердить подготовку новой копии", exact: true })
    .click();
  const response = await pendingResponse;
  expect(response.status()).toBe(200);
  const receipt = (await response.json()) as {
    source_version: string;
    version: string;
    sha256: string;
    diff: unknown[];
    rejected_changes: unknown[];
  };
  const pendingDownload = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe(`offer.koswork.${format}`);
  const bytes = await readFile((await download.path())!);
  expect(receipt.sha256).toBe(hash(bytes));
  expect(receipt.version).toBe("sha256:" + hash(bytes));
  expect(receipt.source_version).toBe("sha256:" + hash(source));
  expect(receipt.rejected_changes).toEqual([]);
  const readbackResponse = await request.post("/api/v1/document-workspace/inspect", {
    data: { name: download.suggestedFilename(), bytes: bytes.toString("base64") }
  });
  expect(readbackResponse.status()).toBe(200);
  const readback = (await readbackResponse.json()) as { version: string; sha256: string };
  expect(readback.version).toBe(receipt.version);
  expect(modelRequests.get(page)).toEqual([]);
  expect(await readFile(`../../docs/handoff/fixtures/koswork-office/offer.${format}`)).toEqual(
    source
  );
  const before = unzipSync(source),
    after = unzipSync(bytes);
  const changed = Object.keys(after)
    .filter((p) => !before[p] || !Buffer.from(before[p]!).equals(Buffer.from(after[p]!)))
    .sort();
  for (const name of Object.keys(before)) {
    expect(after[name]).toBeDefined();
    if (!changed.includes(name)) expect(after[name]).toEqual(before[name]);
  }
  if (process.env.KOSWORK_PLAN_REPORT_DIR) {
    const dir = resolve(process.env.KOSWORK_PLAN_REPORT_DIR, format);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, `source.${format}`), source, { flag: "wx" });
    await writeFile(resolve(dir, `result.${format}`), bytes, { flag: "wx" });
    await writeFile(
      resolve(dir, "result.json"),
      JSON.stringify(
        {
          source_version: receipt.source_version,
          new_version: receipt.version,
          sha256: hash(bytes),
          executed_changes: receipt.diff,
          rejected_changes: receipt.rejected_changes,
          changed_parts: changed,
          original_preserved: true,
          readback_verified: true,
          real_model_called: false,
          visual_render_verified: false,
          readback
        },
        null,
        2
      ) + "\n",
      { flag: "wx" }
    );
  }
  return { bytes, parts: after, changed, receipt, path: (await download.path())! };
}

test("DOCX edits and removes individual operations, invalidates both previews and saves only the reviewed plan", async ({
  page,
  request
}) => {
  const input = await brief();
  const editor = await open(page, "docx");
  await textEdit(editor, "paragraph:3", "Компания А", "Компания Б");
  await textEdit(editor, "table:1/row:1/cell:2", "19 700", input.price);
  await textEdit(editor, "paragraph:3", "кроме доставки", "включая доставку");
  await preview(page, editor);
  await editor.getByRole("button", { name: "Изменить правку 1", exact: true }).click();
  const form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Посмотреть изменения", exact: true })
  ).toBeDisabled();
  await form.getByLabel("Новый текст правки", { exact: true }).fill(input.company);
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  await preview(page, editor);
  await editor.getByRole("button", { name: "Удалить правку 3", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Подтвердить подготовку новой копии" })
  ).toHaveCount(0);
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    2
  );
  const response = await preview(page, editor);
  const body = response.request().postDataJSON() as { operations: unknown[] };
  expect(body.operations).toEqual([
    { kind: "replace_text", target: "paragraph:3", find: "Компания А", replace: input.company },
    { kind: "replace_text", target: "table:1/row:1/cell:2", find: "19 700", replace: input.price }
  ]);
  await expect(editor).toContainText("Файл новой копии: offer.koswork.docx");
  const result = await save(page, editor, request, "docx");
  const xml = strFromU8(result.parts["word/document.xml"]!);
  expect(xml.replace(/<[^>]+>/g, "")).toContain(input.company);
  for (const word of [input.price, "00123", "07.11.2026", "кроме доставки"])
    expect(xml).toContain(word);
  expect(xml).not.toContain("включая доставку");
  expect(result.changed).toEqual(["word/document.xml"]);
});

test("XLSX renames, rebases new-sheet dependencies and edits mixed range and cell values without losing other edits", async ({
  page,
  request
}) => {
  const input = await brief();
  const editor = await open(page, "xlsx");
  for (const name of ["Лишний", "Итог"]) {
    await editor.getByLabel("Новый лист", { exact: true }).fill(name);
    await editor.getByRole("button", { name: "Добавить лист в план", exact: true }).click();
  }
  await editor.getByLabel("Адрес", { exact: true }).selectOption("sheet:3");
  await editor.getByText("Диапазон ячеек XLSX", { exact: true }).click();
  const range = editor.getByRole("group", { name: "Диапазон XLSX", exact: true });
  await range.getByLabel("Таблица диапазона", { exact: true }).fill(input.tsv);
  await range.getByLabel("Начальная ячейка диапазона").fill("A2");
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  for (const [column, type] of [
    [2, "number"],
    [3, "boolean"],
    [4, "formula"]
  ] as const)
    await range.getByLabel(`Тип столбца ${column}`, { exact: true }).selectOption(type);
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  await editor.getByLabel("Адрес", { exact: true }).selectOption("sheet:1");
  await editor.getByLabel("Ячейка", { exact: true }).fill("D1");
  await editor.getByLabel("Значение", { exact: true }).fill("08.11.2026");
  await editor.getByRole("button", { name: "Добавить правку ячейки", exact: true }).click();
  await editor.getByRole("button", { name: "Изменить правку 2", exact: true }).click();
  let form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
  await expect(editor.getByRole("button", { name: "Добавить лист в план" })).toBeDisabled();
  await form.getByLabel("Название листа правки").fill(input.sheet);
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  await editor.getByRole("button", { name: "Удалить правку 1", exact: true }).click();
  await editor.getByRole("button", { name: "Удалить правку 1", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("ссылаются");
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    3
  );
  await editor.getByRole("button", { name: "Изменить правку 2", exact: true }).click();
  form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
  await expect(form.getByLabel("Адрес объекта правки")).toHaveValue("sheet:2");
  await expect(form.getByLabel("Тип ячейки 1:2", { exact: true })).toHaveValue("number");
  await form.getByLabel("Значение ячейки 1:2", { exact: true }).fill(input.amount);
  await form.getByLabel("Тип ячейки 2:3", { exact: true }).selectOption("string");
  await form.getByLabel("Значение ячейки 2:3", { exact: true }).fill("нет");
  await page.screenshot({ path: test.info().outputPath("plan-range-editor.png"), fullPage: true });
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  await editor.getByRole("button", { name: "Изменить правку 3", exact: true }).click();
  form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
  await form.getByLabel("Значение ячейки", { exact: true }).fill(input.date);
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  const response = await preview(page, editor);
  const sent = response.request().postDataJSON() as { operations: unknown[] };
  for (const type of ["Текст", "Число", "Логическое", "Формула без вычисления"])
    await expect(editor).toContainText(`Тип после: ${type}`);
  expect(sent.operations).toEqual([
    { kind: "add_sheet", name: input.sheet },
    {
      kind: "set_range",
      target: "sheet:2",
      start: "A2",
      rows: [
        ["00123", 19800, true, { formula: "SUM(B2:B2)" }],
        ["00456", -12.5, "нет", { formula: "MIN(B2:B3)" }]
      ]
    },
    { kind: "set_cell", target: "sheet:1", address: "D1", value: input.date }
  ]);
  const result = await save(page, editor, request, "xlsx");
  expect(result.changed).toEqual([
    "[Content_Types].xml",
    "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml"
  ]);
  expect(strFromU8(result.parts["xl/workbook.xml"]!)).toContain(input.sheet);
  expect(strFromU8(result.parts["xl/workbook.xml"]!)).not.toContain("Лишний");
  const sheet = strFromU8(result.parts["xl/worksheets/sheet2.xml"]!);
  for (const word of ["00123", "19800", "нет", "SUM(B2:B2)"]) expect(sheet).toContain(word);
  expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>');
  expect(sheet).not.toMatch(/<f>[^<]+<\/f><v>/);
  expect(strFromU8(result.parts["xl/worksheets/sheet1.xml"]!)).toContain(input.date);
  expect(strFromU8(result.parts["xl/worksheets/sheet1.xml"]!)).toContain("кроме доставки");
});

test("invalid draft is retained for correction; cancelling keeps the original operation and requires a new preview", async ({
  page
}) => {
  const editor = await open(page, "xlsx");
  await editor.getByLabel("Значение", { exact: true }).fill("00123");
  await editor.getByRole("button", { name: "Добавить правку ячейки", exact: true }).click();
  await preview(page, editor);
  await editor.getByRole("button", { name: "Изменить правку 1", exact: true }).click();
  const form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
  await form.getByLabel("Тип ячейки", { exact: true }).selectOption("number");
  await form.getByLabel("Значение ячейки", { exact: true }).fill("9007199254740993");
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  await expect(form.getByRole("alert")).toContainText("округления");
  await expect(
    editor.getByRole("button", { name: "Посмотреть изменения", exact: true })
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Подтвердить подготовку новой копии" })
  ).toHaveCount(0);
  await form.getByLabel("Тип ячейки", { exact: true }).selectOption("string");
  await form.getByLabel("Адрес объекта правки", { exact: true }).fill("sheet:9");
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  await expect(editor.getByRole("alert")).toContainText("Лист для правки");
  await expect(form).toBeVisible();
  await form.getByRole("button", { name: "Отменить редактирование правки" }).click();
  const response = await preview(page, editor);
  expect(response.request().postDataJSON()).toMatchObject({
    operations: [{ kind: "set_cell", value: "00123" }]
  });
});

test("late preview cannot restore confirmation after a cancelled request and an edited operation", async ({
  page
}) => {
  const editor = await open(page, "docx");
  await textEdit(editor, "paragraph:3", "Компания А", "Компания Б");
  let release!: () => void, arrived!: () => void, finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  let delayed = true;
  await page.route("**/api/v1/document-workspace/preview", async (route) => {
    if (!delayed) return route.continue();
    delayed = false;
    try {
      const response = await route.fetch();
      arrived();
      await gate;
      await route.fulfill({ response });
    } finally {
      finished();
    }
  });
  try {
    await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
    await received;
    await expect(
      editor.getByRole("button", { name: "Изменить правку 1", exact: true })
    ).toBeDisabled();
    await editor.getByRole("button", { name: "Отменить", exact: true }).click();
    await editor.getByRole("button", { name: "Изменить правку 1", exact: true }).click();
    const form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
    await form.getByLabel("Новый текст правки", { exact: true }).fill("Компания В");
    await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  } finally {
    release();
  }
  await done;
  await expect(
    editor.getByRole("button", { name: "Подтвердить подготовку новой копии" })
  ).toHaveCount(0);
  const response = await preview(page, editor);
  expect(response.request().postDataJSON()).toMatchObject({
    operations: [{ replace: "Компания В" }]
  });
});

test("switching source discards an unfinished draft and PPTX keeps only its edited selected shape", async ({
  page,
  request
}) => {
  const input = await brief();
  const editor = await open(page, "docx");
  await textEdit(editor, "paragraph:3", "Компания А", "Компания Б");
  await editor.getByRole("button", { name: "Изменить правку 1", exact: true }).click();
  await editor.getByLabel("Новый текст правки", { exact: true }).fill("UNSAVED OLD SOURCE");
  await editor
    .locator('input[type="file"]')
    .setInputFiles("../../docs/handoff/fixtures/koswork-office/offer.pptx");
  await expect(editor).toContainText("offer.pptx");
  await expect(
    editor.getByRole("group", { name: "Редактирование правки", exact: true })
  ).toHaveCount(0);
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    0
  );
  await textEdit(editor, "slide:1/shape:2", "Компания А", "Компания Б");
  await textEdit(editor, "slide:1/shape:3", "кроме доставки", "включая доставку");
  await editor.getByRole("button", { name: "Удалить правку 2", exact: true }).click();
  await editor.getByRole("button", { name: "Изменить правку 1", exact: true }).click();
  const form = editor.getByRole("group", { name: "Редактирование правки", exact: true });
  await form.getByLabel("Новый текст правки", { exact: true }).fill(input.company);
  await form.getByRole("button", { name: "Сохранить правку в плане" }).click();
  await preview(page, editor);
  const result = await save(page, editor, request, "pptx");
  expect(strFromU8(result.parts["ppt/slides/slide1.xml"]!)).toContain(input.company);
  expect(strFromU8(result.parts["ppt/slides/slide1.xml"]!)).toContain("кроме доставки");
  expect(strFromU8(result.parts["ppt/slides/slide1.xml"]!)).not.toContain("UNSAVED OLD SOURCE");
  expect(result.changed).toEqual(["ppt/slides/slide1.xml"]);
});

test("deleting the final edit invalidates the old download without deleting an already saved copy", async ({
  page
}) => {
  const editor = await open(page, "docx");
  await textEdit(editor, "paragraph:3", "Компания А", "Компания Б");
  await preview(page, editor);
  // No fixture capture for this extra DOCX run.
  const pending = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const download = await pending;
  const path = (await download.path())!,
    before = await readFile(path);
  await editor.getByRole("button", { name: "Удалить правку 1", exact: true }).click();
  await expect(editor.getByRole("link", { name: "Скачать новая копию" })).toHaveCount(0);
  await expect(
    editor.getByRole("button", { name: "Посмотреть изменения", exact: true })
  ).toBeDisabled();
  expect(await readFile(path)).toEqual(before);
});
