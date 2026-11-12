import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Request } from "@playwright/test";

async function project(request: APIRequestContext) {
  const response = await request.post("/api/v1/projects", {
    data: { initial_message: "Website acceptance", client_message_id: randomUUID() }
  });
  expect(response.ok()).toBe(true);
  const id = ((await response.json()) as { project: { id: string } }).project.id;
  expect(
    (
      await request.put(`/api/v1/projects/${id}/autonomy-profile`, {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).ok()
  ).toBe(true);
  return id;
}

test("creates, previews, edits, downloads and restores a website without changing the main chat", async ({
  page,
  request
}) => {
  const id = await project(request);
  await page.goto(`/?surface=sites&project=${id}`);
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  await page
    .getByLabel("Что создаём?", { exact: true })
    .fill("E2E_WEBSITE_WORK: сайт студии архитектуры");
  await page.getByRole("button", { name: "Создать сайт", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Сайт подготовлен" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть сайт в редакторе", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  const preview = page.frameLocator('iframe[title="Статический предпросмотр сайта"]');
  await expect(preview.getByRole("heading", { name: "Студия Альфа" })).toBeVisible();
  await page.getByRole("button", { name: "Телефон", exact: true }).click();
  expect(
    (await page.locator('iframe[title="Статический предпросмотр сайта"]').boundingBox())!.width
  ).toBe(375);
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const source = canvas.getByLabel("Содержимое", { exact: true });
  const edited = (await source.inputValue()).replace("Студия Альфа", "Студия Космора");
  await source.fill(edited);
  await expect(preview.getByRole("heading", { name: "Студия Космора" })).toBeVisible();
  // Clicking the same Work result again must not reset an unsaved Canvas draft.
  await page.getByRole("button", { name: "Открыть сайт в редакторе", exact: true }).click();
  await expect(source).toHaveValue(edited);
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  const downloaded = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать", exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.html$/);
  expect(await readFile(await file.path(), "utf8")).toBe(edited);
  await page.screenshot({ path: "../../qa/sites-workbench.png", fullPage: true });
  await page.reload();
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  await canvas
    .getByRole("navigation", { name: "Артефакты проекта" })
    .getByRole("button", { name: /Тестовый сайт.*v2/ })
    .click();
  await expect(source).toHaveValue(edited);
  await expect(preview.getByRole("heading", { name: "Студия Космора" })).toBeVisible();
});

test("static preview removes active markup and cannot fetch external resources", async ({
  page,
  request
}) => {
  const id = await project(request);
  await page.goto(`/?surface=sites&project=${id}`);
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  await canvas.getByRole("combobox", { name: "Формат", exact: true }).selectOption("html");
  const requests: Request[] = [];
  page.on("request", (req) => {
    if (req.url().includes("blocked-site-preview.invalid")) requests.push(req);
  });
  await canvas
    .getByLabel("Содержимое", { exact: true })
    .fill(
      `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://blocked-site-preview.invalid/refresh"><style>@import url(https://blocked-site-preview.invalid/css);h1{background:url(https://blocked-site-preview.invalid/pixel)}</style></head><body onload="fetch('https://blocked-site-preview.invalid/onload')"><h1>Безопасный заголовок</h1><script>parent.document.body.textContent='BROKEN'</script><img src="https://blocked-site-preview.invalid/image"><iframe src="https://blocked-site-preview.invalid/frame"></iframe><a href="https://blocked-site-preview.invalid/link" ping="https://blocked-site-preview.invalid/ping">Ссылка</a><svg onload="alert(1)"></svg></body></html>`
    );
  const frame = page.frameLocator('iframe[title="Статический предпросмотр сайта"]');
  await expect(frame.getByRole("heading", { name: "Безопасный заголовок" })).toBeVisible();
  await expect(frame.locator("script,iframe,svg,meta[http-equiv=refresh]")).toHaveCount(0);
  await expect(frame.locator("a")).not.toHaveAttribute("href");
  await expect(page.locator('iframe[title="Статический предпросмотр сайта"]')).toHaveAttribute(
    "sandbox",
    ""
  );
  await page.waitForTimeout(700);
  // Chromium can expose a request attempt even when CSP prevents network dispatch.
  // An actual response, DNS/proxy failure or a pending request must not pass this check.
  for (const attempted of requests) expect(attempted.failure()?.errorText).toMatch(/csp/i);
  await expect(page.getByRole("heading", { name: "Сайты", exact: true, level: 1 })).toBeVisible();
});

test("a lost website creation response is recovered without creating a second paid task", async ({
  page,
  request
}) => {
  const id = await project(request);
  let posts = 0;
  await page.route(`**/api/v1/projects/${id}/work`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await route.fetch();
    await route.fulfill({ status: 503, body: "response lost" });
  });
  await page.goto(`/?surface=sites&project=${id}`);
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  await page
    .getByLabel("Что создаём?", { exact: true })
    .fill("E2E_WEBSITE_WORK: восстановление ответа");
  await page.getByRole("button", { name: "Создать сайт", exact: true }).click();
  await expect(page.getByRole("button", { name: "Проверить запуск", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Проверить запуск", exact: true }).click();
  await expect(page.getByRole("button", { name: "Проверить запуск", exact: true })).toHaveCount(0);
  const result = await request.get(`/api/v1/projects/${id}/work`);
  const works = (
    (await result.json()) as { items: { request: { output_contract?: { kind: string } } }[] }
  ).items;
  expect(works.filter((work) => work.request.output_contract?.kind === "website")).toHaveLength(1);
  expect(posts).toBe(1);
});

test("warns before switching projects with an unsaved site draft and restores it on return", async ({
  page,
  request
}) => {
  const first = await project(request);
  const second = await project(request);
  await page.goto(`/?surface=sites&project=${first}`);
  const picker = page.getByRole("combobox", { name: "Проект сайта", exact: true });
  await picker.selectOption(first);
  const source = page
    .getByRole("region", { name: "Редактор Canvas", exact: true })
    .getByRole("textbox", { name: "Содержимое", exact: true });
  await expect(source).toBeEnabled();
  const unsaved = "<h1>Не терять эту правку</h1>";
  await source.fill(unsaved);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("Несохранённые изменения");
    void dialog.dismiss();
  });
  await picker.selectOption(second);
  await expect(picker).toHaveValue(first);
  await expect(source).toHaveValue(unsaved);
  page.once("dialog", (dialog) => void dialog.accept());
  await picker.selectOption(second);
  await expect(picker).toHaveValue(second);
  await picker.selectOption(first);
  await expect(source).toHaveValue(unsaved);
});

test("audits inert HTML source and invalidates stale findings", async ({ page, request }) => {
  const id = await project(request);
  await page.goto("/?surface=sites&project=" + id);
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  const editor = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  await editor.getByRole("combobox", { name: "Формат", exact: true }).selectOption("html");
  const source = editor.getByRole("textbox", { name: "Содержимое", exact: true });
  const html = [
    "<h1 id='same'>Страница</h1><div id='same'>Повтор</div>",
    "<a href='#missing'>Переход</a><img src='photo.jpg'>",
    "<script>window.evil = true</script><form><input></form>",
    "<iframe src='https://blocked-site-preview.invalid/frame'></iframe>"
  ].join("");
  await source.fill(html);
  const audit = page.getByRole("region", { name: "Диагностика сайта", exact: true });
  await audit.getByRole("button", { name: "Проверить HTML", exact: true }).click();
  await expect(audit).toContainText("Скрипты (1)");
  await expect(audit).toContainText("Формы и элементы ввода (2)");
  await expect(audit).toContainText("Повторяющиеся id: same");
  await expect(audit).toContainText("#missing");
  await expect(audit).toContainText("Изображения без атрибута alt: 1");
  await expect(audit).toContainText("Внешние ссылки на ресурсы");
  await expect(source).toHaveValue(html);
  await expect(page.locator('iframe[title="Статический предпросмотр сайта"]')).toHaveAttribute(
    "sandbox",
    ""
  );
  await source.fill("<h1>Чистая статическая страница</h1>");
  await expect(audit).toContainText("Исходник изменился");
  await audit.getByRole("button", { name: "Проверить HTML", exact: true }).click();
  await expect(audit).toContainText("Явных ограничений");
  await expect(audit).not.toContainText("Скрипты (1)");
});

test("embeds an image in site HTML, rejects SVG and preserves it through export and reload", async ({
  page,
  request
}) => {
  const id = await project(request);
  await page.goto("/?surface=sites&project=" + id);
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  await canvas.getByRole("combobox", { name: "Формат", exact: true }).selectOption("html");
  const source = canvas.getByRole("textbox", { name: "Содержимое", exact: true });
  const original = "<!doctype html><html><body><h1>Атлас</h1></body></html>";
  await source.fill(original);
  const assets = canvas.getByRole("region", { name: "Изображения сайта", exact: true });
  const fileInput = assets.getByLabel("Файл изображения сайта", { exact: true });
  const alt = assets.getByRole("textbox", { name: "Описание изображения (alt)", exact: true });
  const insert = assets.getByRole("button", { name: "Встроить изображение", exact: true });
  await fileInput.setInputFiles({
    name: "unsafe.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg><script>alert(1)</script></svg>")
  });
  await insert.click();
  await expect(assets.getByRole("alert")).toContainText("PNG, JPEG и WebP");
  await expect(source).toHaveValue(original);

  const image = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Nv0AAAAASUVORK5CYII=",
    "base64"
  );
  await fileInput.setInputFiles({ name: "mark.png", mimeType: "image/png", buffer: image });
  await alt.fill("Знак студии");
  await insert.click();
  await expect(source).toHaveValue(/data:image\/png;base64,/);
  const current = await source.inputValue();
  expect(current).toContain('alt="Знак студии"');
  const preview = page.frameLocator('iframe[title="Статический предпросмотр сайта"]');
  await expect(preview.getByRole("img", { name: "Знак студии" })).toHaveAttribute(
    "src",
    /^data:image\/png;base64,/
  );
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const downloaded = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать", exact: true }).click();
  expect(await readFile(await (await downloaded).path(), "utf8")).toBe(current);
  await page.reload();
  await page.getByRole("combobox", { name: "Проект сайта", exact: true }).selectOption(id);
  await canvas
    .getByRole("navigation", { name: "Артефакты проекта" })
    .getByRole("button", { name: /v1/ })
    .click();
  await expect(source).toHaveValue(current);
});
