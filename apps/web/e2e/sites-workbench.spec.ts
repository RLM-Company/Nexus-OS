import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext } from "@playwright/test";

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
  const requests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("blocked-site-preview.invalid")) requests.push(req.url());
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
  expect(requests).toEqual([]);
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
