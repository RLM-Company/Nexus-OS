import { expect, test } from "@playwright/test";

test("previews Manager artifacts as inert text without executing generated markup", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Подготовь набор файлов",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const dangerous =
    '<script>window.__cosmoraPreviewExecuted = true</script><h1>Injected heading</h1>';
  const work = {
    id: "work-result-preview-fixture",
    version: 5,
    status: "completed",
    stage: "done",
    pause_requested: false,
    model_requests: 3,
    error_code: null,
    confirmation_id: null,
    request: { goal: "Подготовь набор файлов" },
    plan: {
      summary: "Подготовить файлы",
      instructions: "Создать безопасные артефакты для скачивания.",
      complexity: "simple",
      needs_critic: false
    },
    draft: {
      files: [
        { name: "dangerous.html", content: dangerous },
        { name: "notes.md", content: "# Notes\n\nГотовый текстовый результат." },
        { name: "large.txt", content: "x".repeat(12_050) }
      ]
    },
    review: { verdict: "PASS", reason: "Структура файлов проверена." },
    events: [
      {
        sequence: 1,
        stage: "plan",
        message: "План готов",
        at: "2026-10-05T11:00:00.000Z"
      },
      {
        sequence: 2,
        stage: "done",
        message: "Файлы готовы",
        at: "2026-10-05T11:01:00.000Z"
      }
    ]
  };

  const mutations: string[] = [];
  page.on("request", (incoming) => {
    if (
      incoming.url().includes("/api/v1/projects/" + project.id + "/work") &&
      incoming.method() !== "GET"
    ) {
      mutations.push(incoming.method() + " " + incoming.url());
    }
  });

  await page.route("**/api/v1/projects/" + project.id + "/work", (route) =>
    route.fulfill({ json: { items: [work] } })
  );
  await page.route("**/api/v1/model-runtime", (route) =>
    route.fulfill({
      json: { mode: "mock", provider: "mock", model: "fixture", fallback_to_mock: false }
    })
  );
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: null } })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) =>
    route.fulfill({ json: null })
  );

  await page.goto("/?project=" + project.id + "&view=plan");
  const panel = page.getByRole("region", { name: "Выполнение задачи Manager" });
  const results = panel.getByRole("region", { name: "Результат Manager" });
  await expect(results).toContainText("3 файла");

  const htmlPreview = panel.getByRole("region", { name: "Предпросмотр файла dangerous.html" });
  await expect(htmlPreview).toContainText("<script>window.__cosmoraPreviewExecuted = true</script>");
  await expect(htmlPreview).toContainText("<h1>Injected heading</h1>");
  expect(await page.evaluate(() => Boolean((window as any).__cosmoraPreviewExecuted))).toBe(false);
  await expect(page.getByRole("heading", { name: "Injected heading", exact: true })).toHaveCount(0);
  await expect(panel.getByRole("link", { name: "dangerous.html", exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Предпросмотр notes.md", exact: true }).click();
  const notesPreview = panel.getByRole("region", { name: "Предпросмотр файла notes.md" });
  await expect(notesPreview).toContainText("# Notes");
  await expect(notesPreview).toContainText("Готовый текстовый результат.");

  await panel.getByRole("button", { name: "Предпросмотр large.txt", exact: true }).click();
  const largePreview = panel.getByRole("region", { name: "Предпросмотр файла large.txt" });
  await expect(largePreview).toContainText("Показаны первые 12");
  await expect(largePreview).toContainText("Полный файл доступен для скачивания.");

  expect(mutations).toEqual([]);
});
