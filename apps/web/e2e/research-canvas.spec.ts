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
