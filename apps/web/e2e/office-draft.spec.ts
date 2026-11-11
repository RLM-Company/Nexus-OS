import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test, expect, type Page, type Locator } from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
const prefix = "koswork:office-plan:v1:";
const fixture = (format: string) => `../../docs/handoff/fixtures/koswork-office/offer.${format}`;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const region = (page: Page) =>
  page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
const draft = (editor: Locator) =>
  editor.getByRole("group", { name: "Черновик плана в этом браузере", exact: true });
async function open(page: Page, format = "docx") {
  await page.goto("/?surface=files");
  const editor = region(page);
  await editor.locator('input[type="file"]').setInputFiles(fixture(format));
  await expect(editor).toContainText("sha256:");
  await expect(draft(editor)).toContainText("Сохранённого черновика");
  return editor;
}
async function add(editor: Locator, format = "docx", company = "Компания В") {
  if (format === "xlsx") {
    await editor.getByLabel("Новый лист", { exact: true }).fill("Итог");
    await editor.getByRole("button", { name: "Добавить лист в план", exact: true }).click();
    await editor.getByLabel("Адрес", { exact: true }).selectOption("sheet:2");
    await editor.getByText("Диапазон ячеек XLSX", { exact: true }).click();
    const range = editor.getByRole("group", { name: "Диапазон XLSX", exact: true });
    await range
      .getByLabel("Таблица диапазона", { exact: true })
      .fill("00123\t19700\ttrue\tSUM(B2:B2)\n00456\t-12.5\tfalse\tMIN(B2:B3)");
    await range.getByLabel("Начальная ячейка диапазона").fill("A2");
    await range.getByRole("button", { name: "Разобрать таблицу" }).click();
    for (const [column, type] of [
      [2, "number"],
      [3, "boolean"],
      [4, "formula"]
    ] as const)
      await range.getByLabel(`Тип столбца ${column}`, { exact: true }).selectOption(type);
    await range.getByRole("button", { name: "Добавить диапазон в план" }).click();
  } else {
    await editor
      .getByLabel("Адрес", { exact: true })
      .selectOption(format === "docx" ? "paragraph:3" : "slide:1/shape:2");
    await editor.getByLabel("Найти точный текст", { exact: true }).fill("Компания А");
    await editor.getByLabel("Заменить на", { exact: true }).fill(company);
    await editor.getByRole("button", { name: "Добавить замену в план", exact: true }).click();
  }
}
async function persist(editor: Locator) {
  await draft(editor)
    .getByRole("button", { name: "Сохранить черновик плана", exact: true })
    .click();
  await expect(draft(editor)).toContainText("Черновик сохранён");
}
async function record(page: Page, format = "docx") {
  return page.evaluate((key) => localStorage.getItem(key)!, prefix + `offer.${format}`);
}
for (const format of ["docx", "xlsx", "pptx"]) {
  test(`${format.toUpperCase()} restores only the explicitly saved plan, requires fresh preview and downloads verified real bytes`, async ({
    page,
    request
  }) => {
    const modelPosts: string[] = [],
      officePosts: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "POST") return;
      const path = new URL(r.url()).pathname;
      if (/\/api\/v1\/(?:chats|projects)(?:\/[^/]+\/(?:messages|work))?$/.test(path))
        modelPosts.push(path);
      if (path.includes("/document-workspace/")) officePosts.push(path);
    });
    let editor = await open(page, format);
    await add(editor, format);
    await persist(editor);
    const raw = await record(page, format);
    const saved = JSON.parse(raw) as { source_version: string; operations: unknown[] };
    expect(Object.keys(saved).sort()).toEqual(
      [
        "schema",
        "revision",
        "savedAt",
        "name",
        "source_version",
        "existingSheets",
        "operations"
      ].sort()
    );
    await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
    await expect(
      editor.getByRole("button", { name: "Подтвердить подготовку новой копии", exact: true })
    ).toBeVisible();
    // Unsaved changes must not replace the explicitly saved plan on unload.
    await editor.getByRole("button", { name: "Удалить правку 1", exact: true }).click();
    if (format === "xlsx") {
      // Referenced new sheet deletion is refused, so clear only the in-memory plan.
      await editor.getByRole("button", { name: "Очистить план", exact: true }).click();
    }
    await page.reload();
    editor = region(page);
    await expect(editor.getByRole("list", { name: "План правок", exact: true })).toHaveCount(0);
    const before = officePosts.length;
    await editor.locator('input[type="file"]').setInputFiles(fixture(format));
    await expect(draft(editor)).toContainText("Найден сохранённый черновик");
    await expect(
      editor.getByRole("list", { name: "План правок" }).getByRole("listitem")
    ).toHaveCount(0);
    await draft(editor)
      .getByRole("button", { name: "Восстановить черновик плана", exact: true })
      .click();
    await expect(draft(editor)).toContainText("План восстановлен");
    expect(officePosts.slice(before)).toEqual(["/api/v1/document-workspace/inspect"]);
    await expect(
      editor.getByRole("button", { name: "Подтвердить подготовку новой копии", exact: true })
    ).toHaveCount(0);
    const previewResponse = page.waitForResponse((r) =>
      r.url().endsWith("/document-workspace/preview")
    );
    await editor.getByRole("button", { name: "Посмотреть изменения", exact: true }).click();
    const preview = await previewResponse;
    expect(preview.status()).toBe(200);
    expect(preview.request().postDataJSON()).toMatchObject({
      expected_version: saved.source_version,
      operations: saved.operations
    });
    const commitResponse = page.waitForResponse((r) =>
      r.url().endsWith("/document-workspace/commit")
    );
    await editor
      .getByRole("button", { name: "Подтвердить подготовку новой копии", exact: true })
      .click();
    const commit = await commitResponse;
    expect(commit.status()).toBe(200);
    const receipt = (await commit.json()) as {
      sha256: string;
      version: string;
      source_version: string;
      diff: unknown[];
    };
    const pendingDownload = page.waitForEvent("download");
    await editor.getByRole("link", { name: "Скачать новую копию", exact: true }).click();
    const download = await pendingDownload;
    expect(download.suggestedFilename()).toBe(`offer.koswork.${format}`);
    const result = await readFile((await download.path())!);
    const source = await readFile(fixture(format));
    expect(receipt).toMatchObject({
      sha256: hash(result),
      version: "sha256:" + hash(result),
      source_version: "sha256:" + hash(source)
    });
    const readbackResponse = await request.post("/api/v1/document-workspace/inspect", {
      data: { name: download.suggestedFilename(), bytes: result.toString("base64") }
    });
    expect(readbackResponse.status()).toBe(200);
    const readback = (await readbackResponse.json()) as { version: string };
    expect(readback.version).toBe(receipt.version);
    const parts = unzipSync(result),
      original = unzipSync(source);
    const changed = Object.keys(parts)
      .filter(
        (name) => !original[name] || !Buffer.from(original[name]!).equals(Buffer.from(parts[name]!))
      )
      .sort();
    for (const name of Object.keys(original)) expect(parts[name]).toBeDefined();
    if (format === "xlsx") {
      expect(changed).toEqual([
        "[Content_Types].xml",
        "xl/_rels/workbook.xml.rels",
        "xl/workbook.xml",
        "xl/worksheets/sheet2.xml"
      ]);
      const sheet = strFromU8(parts["xl/worksheets/sheet2.xml"]!);
      for (const text of ["00123", "19700", "-12.5", "SUM(B2:B2)"]) expect(sheet).toContain(text);
      expect(sheet).not.toMatch(/<f>[^<]+<\/f><v>/);
      expect(strFromU8(parts["xl/worksheets/sheet1.xml"]!)).toContain("кроме доставки");
    } else {
      const part = format === "docx" ? "word/document.xml" : "ppt/slides/slide1.xml";
      expect(changed).toEqual([part]);
      expect(strFromU8(parts[part]!)).toContain("Компания В");
      for (const text of ["00123", "19 700", "07.11.2026", "кроме доставки"])
        expect(JSON.stringify(readback)).toContain(text);
    }
    expect(await readFile(fixture(format))).toEqual(source);
    expect(await record(page, format)).toBe(raw);
    expect(modelPosts).toEqual([]);
    if (process.env.KOSWORK_DRAFT_REPORT_DIR) {
      const dir = resolve(process.env.KOSWORK_DRAFT_REPORT_DIR, format);
      await mkdir(dir, { recursive: true });
      for (const [name, bytes] of [
        [`source.${format}`, source],
        [`result.${format}`, result],
        ["draft.json", raw],
        [
          "result.json",
          JSON.stringify(
            {
              ...receipt,
              changed_parts: changed,
              readback,
              original_preserved: true,
              real_model_called: false,
              rendered: false
            },
            null,
            2
          ) + "\n"
        ]
      ] as const)
        await writeFile(resolve(dir, name), bytes, { flag: "wx" });
    }
  });
}

test("changed source version refuses restoration and overwrite; another filename never receives its plan", async ({
  page
}) => {
  const editor = await open(page);
  await add(editor);
  await persist(editor);
  const raw = await record(page);
  const parts = unzipSync(await readFile(fixture("docx")));
  parts["word/document.xml"] = strToU8(
    strFromU8(parts["word/document.xml"]!).replace("Компания А", "Компания АА")
  );
  await editor.locator('input[type="file"]').setInputFiles({
    name: "offer.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(zipSync(parts))
  });
  await expect(draft(editor)).toContainText("Версия исходника отличается");
  await expect(
    draft(editor).getByRole("button", { name: "Восстановить черновик плана", exact: true })
  ).toBeDisabled();
  await add(editor);
  await draft(editor)
    .getByRole("button", { name: "Сохранить черновик плана", exact: true })
    .click();
  await expect(draft(editor).getByRole("alert")).toContainText("Версия исходника отличается");
  expect(await record(page)).toBe(raw);
  await editor.locator('input[type="file"]').setInputFiles({
    name: "other.docx",
    mimeType: "application/octet-stream",
    buffer: await readFile(fixture("docx"))
  });
  await expect(draft(editor)).toContainText("Сохранённого черновика");
  await expect(
    draft(editor).getByRole("button", { name: "Восстановить черновик плана", exact: true })
  ).toBeDisabled();
});

test("stale tabs cannot overwrite, restore or delete a newer draft; explicit refresh restores the newer plan", async ({
  page,
  context
}) => {
  const first = await open(page);
  await add(first);
  const otherPage = await context.newPage();
  const second = await open(otherPage);
  await add(second, "docx", "Компания Б");
  await persist(first);
  const original = await record(page);
  for (const label of ["Сохранить черновик плана"]) {
    await draft(second).getByRole("button", { name: label, exact: true }).click();
    await expect(draft(second).getByRole("alert")).toContainText("другой вкладке");
  }
  await draft(second)
    .getByRole("button", { name: "Проверить сохранённый черновик", exact: true })
    .click();
  await persist(second);
  const newer = await record(page);
  expect(newer).not.toBe(original);
  for (const label of [
    "Восстановить черновик плана",
    "Удалить сохранённый черновик",
    "Сохранить черновик плана"
  ]) {
    await draft(first).getByRole("button", { name: label, exact: true }).click();
    await expect(draft(first).getByRole("alert")).toContainText("другой вкладке");
    expect(await record(page)).toBe(newer);
  }
  await expect(first.getByRole("list", { name: "План правок" })).toContainText("Компания В");
  await draft(first)
    .getByRole("button", { name: "Проверить сохранённый черновик", exact: true })
    .click();
  await draft(first)
    .getByRole("button", { name: "Восстановить черновик плана", exact: true })
    .click();
  await expect(first.getByRole("list", { name: "План правок" })).toContainText("Компания Б");
  await otherPage.close();
});

test("invalid or expired local records cannot restore and explicit deletion leaves the editor plan intact", async ({
  page
}) => {
  const editor = await open(page);
  await add(editor);
  await persist(editor);
  const raw = await record(page);
  for (const content of [
    "{",
    JSON.stringify({ ...JSON.parse(raw), savedAt: 1 }),
    JSON.stringify({ ...JSON.parse(raw), preview_token: "forbidden" })
  ]) {
    await page.evaluate(({ key, content }) => localStorage.setItem(key, content), {
      key: prefix + "offer.docx",
      content
    });
    await draft(editor)
      .getByRole("button", { name: "Проверить сохранённый черновик", exact: true })
      .click();
    await expect(
      draft(editor).getByRole("button", { name: "Восстановить черновик плана", exact: true })
    ).toBeDisabled();
    await expect(draft(editor)).toContainText(/повреждён|истёк/);
  }
  await draft(editor)
    .getByRole("button", { name: "Удалить сохранённый черновик", exact: true })
    .click();
  await expect(draft(editor)).toContainText("Сохранённый черновик удалён");
  expect(await record(page)).toBeNull();
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    1
  );
  await expect(
    editor.getByRole("button", { name: "Посмотреть изменения", exact: true })
  ).toBeEnabled();
});

test("quota and unavailable storage preserve the saved record and current plan without model requests", async ({
  page
}) => {
  const editor = await open(page);
  await add(editor);
  await persist(editor);
  const raw = await record(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Нет места", "QuotaExceededError");
    };
  });
  await draft(editor)
    .getByRole("button", { name: "Сохранить черновик плана", exact: true })
    .click();
  await expect(draft(editor).getByRole("alert")).toContainText("Нет места");
  expect(await record(page)).toBe(raw);
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    1
  );
  await page.evaluate(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Нет доступа", "SecurityError");
    };
  });
  await draft(editor)
    .getByRole("button", { name: "Проверить сохранённый черновик", exact: true })
    .click();
  await expect(draft(editor).getByRole("alert")).toContainText("Хранилище браузера недоступно");
});

test("unfinished edits cannot be persisted; clearing the plan keeps the saved draft until explicit deletion", async ({
  page
}) => {
  const editor = await open(page);
  await add(editor);
  await persist(editor);
  const raw = await record(page);
  await editor.getByRole("button", { name: "Изменить правку 1", exact: true }).click();
  await editor.getByLabel("Новый текст правки", { exact: true }).fill("UNSAVED");
  await expect(
    draft(editor).getByRole("button", { name: "Сохранить черновик плана", exact: true })
  ).toBeDisabled();
  await editor.getByRole("button", { name: "Отменить редактирование правки", exact: true }).click();
  await editor.getByRole("button", { name: "Очистить план", exact: true }).click();
  expect(await record(page)).toBe(raw);
  await draft(editor)
    .getByRole("button", { name: "Восстановить черновик плана", exact: true })
    .click();
  await expect(editor.getByRole("list", { name: "План правок" })).toContainText("Компания В");
  await expect(editor.getByRole("list", { name: "План правок" })).not.toContainText("UNSAVED");
});

test("a busy cross-tab lock refuses writes immediately without queued restoration after source switching", async ({
  page,
  context
}) => {
  const editor = await open(page);
  await add(editor);
  await persist(editor);
  const raw = await record(page);
  const holder = await context.newPage();
  await holder.goto("/?surface=files");
  await holder.evaluate(async () => {
    const state = window as typeof window & { releaseOfficeLock?: () => void };
    await new Promise<void>((acquired) => {
      void navigator.locks.request("koswork:office-plan:v1:", async () => {
        acquired();
        await new Promise<void>((release) => {
          state.releaseOfficeLock = release;
        });
      });
    });
  });
  try {
    for (const name of [
      "Сохранить черновик плана",
      "Восстановить черновик плана",
      "Удалить сохранённый черновик"
    ]) {
      await draft(editor).getByRole("button", { name, exact: true }).click();
      await expect(draft(editor).getByRole("alert")).toContainText("используется другой вкладкой");
      expect(await record(page)).toBe(raw);
    }
    await editor.locator('input[type="file"]').setInputFiles(fixture("pptx"));
    await expect(editor).toContainText("offer.pptx");
  } finally {
    await holder.evaluate(() =>
      (window as typeof window & { releaseOfficeLock?: () => void }).releaseOfficeLock?.()
    );
    await holder.close();
  }
  await expect(editor.getByRole("list", { name: "План правок" }).getByRole("listitem")).toHaveCount(
    0
  );
  expect(await record(page)).toBe(raw);
});
