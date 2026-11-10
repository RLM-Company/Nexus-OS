import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
const sourcePath = "../../docs/handoff/fixtures/koswork-office/offer.xlsx";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function openRange(page: Page) {
  await page.goto("/?surface=files");
  const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
  await editor.locator('input[type="file"]').setInputFiles(sourcePath);
  await expect(editor).toContainText("sha256:");
  await editor.getByText("Диапазон ячеек XLSX", { exact: true }).click();
  return { editor, range: editor.getByRole("group", { name: "Диапазон XLSX", exact: true }) };
}

test("typed range reaches real XLSX bytes through preview and a separate confirmation", async ({
  page,
  request
}, info) => {
  const input = JSON.parse(
    await readFile("../../docs/handoff/fixtures/koswork-xlsx-range/input.json", "utf8")
  ) as { tsv: string; new_sheet: string; start: string; column_types: string[] };
  const source = await readFile(sourcePath);
  const modelPosts: string[] = [];
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      /\/api\/v1\/(?:chats|projects)(?:\/[^/]+\/(?:messages|work))?$/.test(
        new URL(r.url()).pathname
      )
    )
      modelPosts.push(r.url());
  });
  const { editor, range } = await openRange(page);
  await editor.getByLabel("Новый лист", { exact: true }).fill(input.new_sheet);
  await editor.getByRole("button", { name: "Добавить лист в план", exact: true }).click();
  await editor.getByLabel("Адрес", { exact: true }).selectOption("sheet:2");
  await range.getByLabel("Начальная ячейка диапазона").fill(input.start);
  await range.getByLabel("Таблица диапазона").fill(input.tsv);
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  for (let c = 0; c < input.column_types.length; c++) {
    await expect(range.getByLabel(`Тип столбца ${c + 1}`, { exact: true })).toHaveValue("string");
    await range
      .getByLabel(`Тип столбца ${c + 1}`, { exact: true })
      .selectOption(input.column_types[c]!);
  }
  const viewport = range.getByRole("region", { name: "Прокрутка диапазона" });
  const bounds = await viewport.boundingBox(),
    editorBounds = await editor.boundingBox();
  expect(bounds).not.toBeNull();
  expect(editorBounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(editorBounds!.x + editorBounds!.width);
  await range.getByLabel("Тип столбца 5", { exact: true }).focus();
  const lastColumn = await range.getByLabel("Тип столбца 5", { exact: true }).boundingBox();
  expect(lastColumn!.x + lastColumn!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  await page.screenshot({ path: info.outputPath("range-plan.png"), fullPage: true });
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    2
  );
  const preparing = page.waitForResponse((r) => r.url().endsWith("/document-workspace/preview"));
  await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
  const previewResponse = await preparing;
  expect(previewResponse.status()).toBe(200);
  const preview = (await previewResponse.json()) as {
    source_version: string;
    version: string;
    diff: unknown[];
  };
  const submitted = previewResponse.request().postDataJSON() as {
    operations: Array<{ kind: string; rows?: unknown[][] }>;
  };
  expect(submitted.operations[1]).toMatchObject({
    kind: "set_range",
    rows: [
      ["00123", 19700, true, { formula: "SUM(B2:B2)" }, expect.any(String)],
      ["00456", -12.5, false, { formula: "MIN(B2:B3)" }, "не включать доставку"]
    ]
  });
  expect(preview.diff).toHaveLength(11);
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  const committing = page.waitForResponse((r) => r.url().endsWith("/document-workspace/commit"));
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  const response = await committing;
  expect(response.status()).toBe(200);
  const committed = (await response.json()) as {
    source_version: string;
    version: string;
    sha256: string;
    diff: unknown[];
    rejected_changes: unknown[];
  };
  const pending = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const download = await pending;
  const bytes = await readFile((await download.path())!);
  expect(download.suggestedFilename()).toBe("offer.koswork.xlsx");
  expect(sha256(bytes)).toBe(committed.sha256);
  expect(committed.version).toBe("sha256:" + sha256(bytes));
  expect(committed.version).toBe(preview.version);
  expect(committed.source_version).toBe(preview.source_version);
  expect(committed.rejected_changes).toEqual([]);
  const before = unzipSync(source),
    after = unzipSync(bytes);
  expect(after["xl/worksheets/sheet1.xml"]).toEqual(before["xl/worksheets/sheet1.xml"]);
  const changedParts = Object.keys(after)
    .filter(
      (name) => !before[name] || !Buffer.from(after[name]!).equals(Buffer.from(before[name]!))
    )
    .sort();
  expect(changedParts).toEqual([
    "[Content_Types].xml",
    "xl/_rels/workbook.xml.rels",
    "xl/workbook.xml",
    "xl/worksheets/sheet2.xml"
  ]);
  for (const name of Object.keys(before)) {
    expect(after[name]).toBeDefined();
    if (!changedParts.includes(name)) expect(after[name]).toEqual(before[name]);
  }
  const sheet = strFromU8(after["xl/worksheets/sheet2.xml"]!);
  for (const literal of [
    "00123",
    "00456",
    "19700",
    "-12.5",
    "07.11.2026",
    "кроме доставки",
    "условие обязательно",
    "не включать доставку"
  ])
    expect(sheet).toContain(literal);
  expect(sheet).toContain('<c r="C2" t="b"><v>1</v></c>');
  expect(sheet).toContain('<c r="D2"><f>SUM(B2:B2)</f></c>');
  expect(sheet).not.toMatch(/<f>[^<]+<\/f><v>/);
  const rereadResponse = await request.post("/api/v1/document-workspace/inspect", {
    data: { name: download.suggestedFilename(), bytes: bytes.toString("base64") }
  });
  expect(rereadResponse.status()).toBe(200);
  const reread = (await rereadResponse.json()) as { version: string; sha256: string };
  expect(reread.version).toBe(committed.version);
  expect(reread.sha256).toBe(committed.sha256);
  expect(await readFile(sourcePath)).toEqual(source);
  expect(modelPosts).toEqual([]);
  await writeFile(info.outputPath("range.koswork.xlsx"), bytes);
  await info.attach("actual range workbook", {
    path: info.outputPath("range.koswork.xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const report = {
    source_version: committed.source_version,
    new_version: committed.version,
    sha256: committed.sha256,
    executed_changes: committed.diff,
    rejected_changes: committed.rejected_changes,
    changed_parts: changedParts,
    original_preserved: true,
    readback_verified: true,
    real_model_called: false,
    visual_render_verified: false,
    untouched_source_sheet_verified: true,
    formulas_calculated: false,
    readback: reread
  };
  await writeFile(info.outputPath("result.json"), JSON.stringify(report, null, 2) + "\n");
  if (process.env.KOSWORK_RANGE_REPORT_DIR) {
    const dir = resolve(process.env.KOSWORK_RANGE_REPORT_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "source.xlsx"), source, { flag: "wx" });
    await writeFile(resolve(dir, "range.koswork.xlsx"), bytes, { flag: "wx" });
    await writeFile(resolve(dir, "result.json"), JSON.stringify(report, null, 2) + "\n", {
      flag: "wx"
    });
  }
});

test("range text stays literal and editing pasted data invalidates the parsed table", async ({
  page
}) => {
  const { editor, range } = await openRange(page);
  await range.getByLabel("Таблица диапазона").fill("stale\t=SUM(A1:A1)");
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await range.getByLabel("Таблица диапазона").fill("00123\t=SUM(A1:A1)");
  await expect(range.getByRole("button", { name: "Добавить диапазон в план" })).toHaveCount(0);
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  const pending = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const parts = unzipSync(await readFile((await (await pending).path())!));
  const xml = strFromU8(parts["xl/worksheets/sheet1.xml"]!);
  expect(xml).toContain("00123");
  expect(xml).toContain("=SUM(A1:A1)");
  expect(xml).not.toContain("<f>");
  expect(xml).not.toContain("stale");
  expect(xml).toContain("кроме доставки");
  expect(xml).toContain("07.11.2026");
});

test("range refuses ragged data, silent numeric rounding and address overflow before preview", async ({
  page
}) => {
  const { editor, range } = await openRange(page);
  let previews = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/document-workspace/preview")) previews++;
  });
  await range.getByLabel("Таблица диапазона").fill("one\ttwo\nthree");
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await expect(range.getByRole("alert")).toContainText("разное число");
  await range.getByLabel("Таблица диапазона").fill("9007199254740993");
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await range.getByLabel("Тип столбца 1", { exact: true }).selectOption("number");
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  await expect(range.getByRole("alert")).toContainText("без округления");
  await range.getByLabel("Таблица диапазона").fill("1\t2");
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await range.getByLabel("Начальная ячейка диапазона").fill("XFD1");
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  await expect(range.getByRole("alert")).toContainText("адреса");
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    0
  );
  expect(previews).toBe(0);
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
});

test("an unsupported range formula is refused before a copy can be downloaded", async ({
  page
}) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "example.test") externalRequests.push(request.url());
  });
  const { editor, range } = await openRange(page);
  await range.getByLabel("Таблица диапазона").fill('"=HYPERLINK(""https://example.test"")"');
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await range.getByLabel("Тип столбца 1", { exact: true }).selectOption("formula");
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  const pending = page.waitForResponse((r) => r.url().endsWith("/document-workspace/preview"));
  await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
  expect((await pending).status()).toBe(422);
  await expect(editor.getByRole("alert")).toContainText("Операция отклонена");
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  expect(externalRequests).toEqual([]);
});

test("cancelling a delayed range preview retains its plan and requires a fresh explicit preview", async ({
  page
}) => {
  const { editor, range } = await openRange(page);
  await range.getByLabel("Таблица диапазона").fill("00123\tкроме доставки");
  await range.getByRole("button", { name: "Разобрать таблицу" }).click();
  await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  let release!: () => void, arrived!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  let delayed = true;
  let previews = 0;
  await page.route("**/api/v1/document-workspace/preview", async (route) => {
    previews++;
    if (!delayed) return route.continue();
    delayed = false;
    const response = await route.fetch();
    arrived();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
    await received;
    await expect(range.getByRole("button", { name: "Добавить диапазон в план" })).toBeDisabled();
    await editor.getByRole("button", { name: "Отменить", exact: true }).click();
  } finally {
    release();
  }
  await expect(range.getByRole("button", { name: "Добавить диапазон в план" })).toBeEnabled();
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toHaveCount(0);
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    1
  );
  expect(previews).toBe(1);
  await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
  expect(previews).toBe(2);
});
