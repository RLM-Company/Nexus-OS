import { randomUUID } from "node:crypto";
import { expect, test, type Page, type APIRequestContext, type Route } from "@playwright/test";

const timestamp = "2026-10-22T00:00:00.000Z";
const report =
  "# Исследование\n\nТочный вывод [S1:E1](https://example.org/archive)\n\n> Исходная цитата\n\n<script>window.researchUnsafe=true</script>\n";
const run = (project: string, question = "Первый отчёт") => ({
  id: randomUUID(),
  project_id: project,
  question,
  status: "completed",
  stage: "Готово",
  next_index: 1,
  candidates: [{ url: "https://example.org/archive" }],
  sources: [
    {
      title: "Архив",
      url: "https://example.org/archive",
      snippet: "Описание",
      status: "read",
      passages: ["Исходная цитата"],
      checked_at: timestamp
    }
  ],
  attempts: 1,
  error_code: null,
  created_at: timestamp,
  updated_at: timestamp
});
async function project(request: APIRequestContext) {
  const created = await request.post("/api/v1/projects/empty", {
    data: { title: "Исследования в Canvas", client_project_id: randomUUID() }
  });
  expect(created.status()).toBe(201);
  return (await created.json()).project.id as string;
}
async function routes(
  page: Page,
  items: ReturnType<typeof run>[],
  exported: (route: Route) => Promise<void>
) {
  await page.route("**/api/v1/research**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.includes("/export/")) return exported(route);
    if (path.endsWith("/status"))
      return route.fulfill({
        json: {
          available: false,
          model_usage: "unavailable",
          limits: { maxSources: 4, maxRunMilliseconds: 45000 }
        }
      });
    return route.fulfill({ json: { items } });
  });
  await page.goto("/research-workspace");
  await expect(
    page.getByRole("button", { name: "Открыть отчёт в Canvas", exact: true })
  ).toBeVisible();
}

test("restores a selected report from its URL without launching research", async ({
  page,
  request
}) => {
  const projectId = await project(request);
  const first = run(projectId, "Свежий отчёт");
  const older = run(projectId, "Отчёт для восстановления");
  let starts = 0;
  let openedOlder = 0;
  await routes(page, [first, older], (route) => route.fulfill({ body: report }));
  await page.route("**/api/v1/research", (route) => {
    if (route.request().method() !== "GET") starts++;
    return route.fulfill({ json: { items: [first] } });
  });
  await page.route("**/api/v1/research/" + older.id, (route) => {
    expect(route.request().method()).toBe("GET");
    openedOlder++;
    return route.fulfill({ json: older });
  });
  await page.getByRole("button", { name: /Отчёт для восстановления/ }).click();
  await expect(page).toHaveURL(new RegExp(`[?&]run_id=${older.id}`));
  await page.reload();
  await expect(page.getByRole("heading", { name: older.question, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: first.question, exact: true })).toHaveCount(0);
  expect(openedOlder).toBe(1);
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect.poll(() => openedOlder).toBe(2);
  await expect(page.getByRole("heading", { name: older.question, exact: true })).toBeVisible();

  const missing = randomUUID();
  await page.route("**/api/v1/research/" + missing, (route) =>
    route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND" } } })
  );
  await page.goto(`/research-workspace?run_id=${missing}&query=ignored&source=chat`);
  await expect(
    page.getByRole("alert").filter({ hasText: "Выбранный отчёт недоступен." })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: first.question, exact: true })).toHaveCount(0);
  expect(starts).toBe(0);
});

test("rechecks a selected research source without replacing saved excerpts", async ({
  page,
  request
}) => {
  const projectId = await project(request);
  const saved = run(projectId);
  saved.sources.push({
    ...saved.sources[0]!,
    url: "https://example.org/second",
    title: "Второй источник"
  });
  await routes(page, [saved], (route) => route.fulfill({ body: report }));
  await page.route("**/api/v1/research/" + saved.id + "/recheck-source", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ source_index: 1 });
    await route.fulfill({ json: { status: "changed", checked_at: timestamp } });
  });
  await page.getByText("Перепроверить источник", { exact: true }).click();
  await page.getByRole("combobox", { name: "Источник для перепроверки" }).selectOption("1");
  await page.getByRole("button", { name: "Проверить сейчас" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Прочитанный текст изменился" })
  ).toBeVisible();
  await expect(page.getByText("Исходная цитата", { exact: false }).first()).toBeVisible();
});

test("compares stored evidence within a project and clears the comparison on navigation", async ({
  page,
  request
}) => {
  const projectId = await project(request);
  const before = run(projectId, "Предыдущий отчёт");
  const after = run(projectId, "Текущий отчёт");
  const source = before.sources[0]!;
  const earlier = {
    ...before,
    sources: [
      { ...source, content_digest: "a".repeat(64) },
      { ...source, title: "Старый адрес", url: "https://example.org/old" },
      { ...source, title: "Проверка доступа", url: "https://example.org/access" }
    ]
  };
  const current = {
    ...after,
    sources: [
      { ...source, content_digest: "b".repeat(64), passages: ["Новая цитата"] },
      { ...source, title: "Новый адрес", url: "https://example.org/new" },
      {
        ...source,
        title: "Проверка доступа",
        url: "https://example.org/access",
        status: "unavailable",
        passages: []
      }
    ]
  };
  const foreign = run(randomUUID(), "Отчёт другого проекта");
  await routes(page, [current, earlier, foreign], (route) => route.fulfill({ body: report }));
  await page.getByText("Сравнить источники", { exact: true }).click();
  const select = page.getByRole("combobox", { name: "Отчёт для сравнения" });
  await expect(select.getByRole("option")).toHaveCount(2);
  await select.selectOption(earlier.id);
  await expect(page.getByText("Изменился прочитанный текст · Изменились выдержки")).toBeVisible();
  await expect(page.getByText("Отсутствует в текущем отчёте", { exact: true })).toBeVisible();
  await expect(page.getByText("Добавлен", { exact: true })).toBeVisible();
  await expect(page.getByText("Прочитан → Недоступен", { exact: true })).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Изменился прочитанный текст" })
    .getByText("Сохранённые выдержки")
    .click();
  await expect(page.getByText("Новая цитата", { exact: true }).last()).toBeVisible();

  await page.getByRole("button", { name: /Предыдущий отчёт/ }).click();
  await expect(page.getByText("Изменился прочитанный текст · Изменились выдержки")).toHaveCount(0);
});

test("research launch retries an unchanged form with the original request ID", async ({
  page,
  request
}) => {
  const projectId = await project(request);
  const question = "Как менялась промышленность?";
  const saved = run(projectId, question);
  const posts: unknown[] = [];
  await page.route("**/api/v1/research**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/status"))
      return route.fulfill({
        json: {
          available: true,
          model_usage: "unavailable",
          limits: { maxSources: 4, maxRunMilliseconds: 45000 }
        }
      });
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      if (posts.length === 1) return route.abort("connectionreset");
      return route.fulfill({ status: 200, json: saved });
    }
    return route.fulfill({ json: { items: posts.length ? [saved] : [] } });
  });
  await page.goto("/research-workspace");
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption(projectId);
  const field = page.getByRole("textbox", { name: "Вопрос", exact: true });
  const start = page.getByRole("button", { name: "Исследовать", exact: true });
  await field.fill(question);
  await start.click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("Связь прервалась");
  await expect(field).toHaveValue(question);
  await start.click();
  await expect(field).toHaveValue("");
  expect(posts).toHaveLength(2);
  expect(posts[0]).toMatchObject({
    project_id: projectId,
    question,
    client_request_id: expect.any(String)
  });
  expect(posts[1]).toEqual(posts[0]);
});

test("research copy keeps citations, saves real Canvas revisions and reopens edits without a model call", async ({
  page,
  request
}) => {
  const id = await project(request),
    research = run(id);
  let exports = 0,
    writes = 0,
    modelCalls = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === `/api/v1/projects/${id}/canvas`)
      writes++;
    if (r.method() === "POST" && /research|\/messages|\/runs/.test(new URL(r.url()).pathname))
      modelCalls++;
  });
  await routes(page, [research], async (route) => {
    exports++;
    expect(route.request().headers()["x-research-updated-at"]).toBe(timestamp);
    await route.fulfill({ contentType: "text/markdown; charset=utf-8", body: report });
  });
  expect(exports).toBe(0);
  const open = page.getByRole("button", { name: "Открыть отчёт в Canvas", exact: true });
  await open.click();
  const modal = page.getByRole("dialog", { name: "Документ в Canvas", exact: true });
  const content = modal.getByLabel("Содержимое", { exact: true });
  await expect(content).toHaveValue(report);
  expect(writes).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, "researchUnsafe"))).toBeUndefined();
  const edited = report + "\nРедакция владельца.";
  await content.fill(edited);
  await modal.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("Артефакт создан");
  const list = await (await request.get(`/api/v1/projects/${id}/canvas`)).json();
  expect(list.items).toHaveLength(1);
  const artifactId = list.items[0].id as string;
  await content.fill(edited + "\nВторая версия.");
  await modal.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("Сохранена новая версия");
  const first = await (
    await request.get(`/api/v1/projects/${id}/canvas/${artifactId}/revisions/1`)
  ).json();
  expect(first.content).toBe(edited);
  await modal.getByRole("button", { name: "Закрыть документ Canvas", exact: true }).click();
  await page.reload();
  await open.click();
  await expect(content).toHaveValue(edited + "\nВторая версия.");
  const downloading = page.waitForEvent("download");
  await modal.getByRole("button", { name: "Скачать", exact: true }).click();
  const download = await downloading;
  const { readFile } = await import("node:fs/promises");
  expect((await readFile((await download.path())!)).toString()).toBe(edited + "\nВторая версия.");
  expect(writes).toBe(1);
  expect(modelCalls).toBe(0);
  await page.screenshot({ path: "../../qa/research-canvas.png", fullPage: true });
});

test("a stale report cannot silently become a Canvas draft", async ({ page, request }) => {
  const id = await project(request);
  await routes(page, [run(id)], async (route) => {
    await route.fulfill({ status: 412, json: { error: { code: "RESEARCH_CHANGED" } } });
  });
  await page.getByRole("button", { name: "Открыть отчёт в Canvas", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Исследование изменилось" })
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Документ в Canvas", exact: true })).toBeHidden();
  expect((await (await request.get(`/api/v1/projects/${id}/canvas`)).json()).items).toEqual([]);
});

test("switching reports cancels loading and a late response cannot open in another project", async ({
  page,
  request
}) => {
  const firstProject = await project(request),
    secondProject = await project(request);
  const first = run(firstProject),
    second = run(secondProject, "Другой отчёт");
  let held: Route | undefined;
  const failures: string[] = [];
  page.on("requestfailed", (r) => {
    if (r.url().includes("/export/md")) failures.push(r.url());
  });
  await routes(page, [first, second], async (route) => {
    held = route;
  });
  await page.getByRole("button", { name: "Открыть отчёт в Canvas", exact: true }).click();
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.getByRole("button", { name: /Другой отчёт/ }).click();
  await expect.poll(() => failures.length).toBe(1);
  await expect(page.getByRole("heading", { name: "Другой отчёт", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Документ в Canvas", exact: true })).toBeHidden();
  expect(
    (await (await request.get(`/api/v1/projects/${firstProject}/canvas`)).json()).items
  ).toEqual([]);
  expect(
    (await (await request.get(`/api/v1/projects/${secondProject}/canvas`)).json()).items
  ).toEqual([]);
});

test("shows Research evidence and excludes a source using the existing project API", async ({
  page,
  request
}) => {
  const projectId = await project(request);
  const saved = {
    ...run(projectId),
    receipts: [
      {
        title: "Архив предложений",
        url: "https://example.org/archive",
        quote: "Итого 19 700, кроме доставки.",
        claim: "Доставка оплачивается отдельно.",
        checked_at: timestamp,
        excerpt_sha256: "a".repeat(64),
        project_source_id: "b".repeat(64)
      }
    ]
  };
  await routes(page, [saved], (route) => route.fulfill({ body: report }));
  const receipts = page.getByText("Квитанции источников", { exact: true });
  await receipts.click();
  const archive = page.getByRole("link", { name: "Архив предложений" });
  await expect(archive).toHaveAttribute("href", "https://example.org/archive");
  await expect(page.getByText("Итого 19 700, кроме доставки.", { exact: true })).toBeVisible();
  await expect(page.getByText("a".repeat(64), { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Исключить из новых исследований" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Источник исключён" })).toBeVisible();
  const readback = await request.get(`/api/v1/projects/${projectId}/sources/exclusions`);
  expect(readback.ok()).toBe(true);
  expect((await readback.json()).items).toMatchObject([
    { source_kind: "research_page", source_id: "b".repeat(64) }
  ]);
  await expect(archive).toBeVisible();
});

test("follows up on a persisted report and restores its origin after reload", async ({
  page,
  request
}) => {
  const projectId = await project(request);
  const profile = await request.put(`/api/v1/projects/${projectId}/autonomy-profile`, {
    data: { base_level: "A1", overrides: [], expected_version: 1 }
  });
  expect(profile.ok()).toBe(true);
  const question = "Какой код указан в архиве лунной станции?";
  const revised = "Какой код архива лунной станции указан в реестре?";
  await page.goto("/research-workspace");
  await page.getByRole("combobox", { name: "Проект", exact: true }).selectOption(projectId);
  const field = page.getByRole("textbox", { name: "Вопрос", exact: true });
  const start = page.getByRole("button", { name: "Исследовать", exact: true });
  await field.fill(question);
  await start.click();
  const refine = page.getByRole("button", { name: "Уточнить вопрос", exact: true });
  await expect(refine).toBeVisible();
  await expect(page.getByText(/SELENE-047/).first()).toBeVisible();
  await page.getByText("S1 · Происхождение не проверено").click();
  await page.getByLabel("Происхождение S1").selectOption("primary");
  await page.getByLabel("Основание S1").fill("Запись владельца открытого реестра станции");
  await page.getByRole("button", { name: "Сохранить отметку S1" }).click();
  await expect(page.getByText("S1 · Первичный источник (отметка владельца)")).toBeVisible();
  const original = new URL(page.url()).searchParams.get("run_id");
  await refine.click();
  await expect(field).toHaveValue(question);
  await expect(start).toBeDisabled();
  await field.fill(revised);
  await start.click();
  await expect(page.getByRole("heading", { name: revised, exact: true })).toBeVisible();
  await expect(refine).toBeVisible();
  expect(new URL(page.url()).searchParams.get("run_id")).not.toBe(original);
  await page.reload();
  await expect(page.getByRole("heading", { name: revised, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Открыть исходное исследование" }).click();
  await expect(page.getByRole("heading", { name: question, exact: true })).toBeVisible();
  await expect(page.getByText("S1 · Первичный источник (отметка владельца)")).toBeVisible();
  expect(new URL(page.url()).searchParams.get("run_id")).toBe(original);
});
