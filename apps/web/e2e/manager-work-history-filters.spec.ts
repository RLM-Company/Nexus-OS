import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function createProject(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Проверь историю задач Manager",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

const event = (sequence: number, stage: string, message: string) => ({
  sequence,
  stage,
  message,
  at: "2026-10-06T08:00:00.000Z"
});

const baseWork = {
  pause_requested: false,
  confirmation_id: null,
  plan: null,
  draft: null,
  review: null
};

const panel = (page: Page) => page.getByRole("region", { name: "Выполнение задачи Manager" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: null } })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) =>
    route.fulfill({ json: null })
  );
});

test("filters Manager history by active, attention and completed state", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  let resolvedAttention = false;

  await page.route(`**/api/v1/projects/${projectId}/work`, (route) => {
    const blockedStatus = resolvedAttention ? "queued" : "blocked";
    const failedStatus = resolvedAttention ? "completed" : "failed";
    return route.fulfill({
      json: {
        items: [
          {
            ...baseWork,
            id: "queued-work",
            version: 1,
            status: "queued",
            stage: "plan",
            model_requests: 0,
            error_code: null,
            events: [event(1, "plan", "Задача поставлена в очередь")],
            request: { goal: "Активная задача" }
          },
          {
            ...baseWork,
            id: "blocked-work",
            version: 4,
            status: blockedStatus,
            stage: "publish",
            model_requests: 2,
            error_code: resolvedAttention ? null : "WAITING_CONFIRMATION",
            plan: {
              summary: "Сохранить файл",
              instructions: "Сохранить готовый результат",
              complexity: "simple",
              needs_critic: false
            },
            draft: { files: [{ name: "blocked.md", content: "# blocked" }] },
            events: [event(1, "publish", "Сохранение файлов ожидает разрешения")],
            request: { goal: "Задача с разрешением" }
          },
          {
            ...baseWork,
            id: "failed-work",
            version: 3,
            status: failedStatus,
            stage: resolvedAttention ? "done" : "review",
            model_requests: 3,
            error_code: resolvedAttention ? null : "CRITIC_REJECTED",
            plan: {
              summary: "Проверить результат",
              instructions: "Подготовить и проверить файл",
              complexity: "complex",
              needs_critic: true
            },
            draft: { files: [{ name: "review.md", content: "# review" }] },
            review: resolvedAttention ? { verdict: "PASS", reason: "Исправлено" } : {
              verdict: "FAIL",
              reason: "Нужно исправление"
            },
            events: [event(1, "review", "Критик завершил проверку")],
            request: { goal: "Задача Критика" }
          },
          {
            ...baseWork,
            id: "completed-work",
            version: 5,
            status: "completed",
            stage: "done",
            model_requests: 2,
            error_code: null,
            plan: {
              summary: "Готовый результат",
              instructions: "Создать файл",
              complexity: "simple",
              needs_critic: false
            },
            draft: { files: [{ name: "ready.md", content: "# ready" }] },
            events: [event(1, "done", "Файл готов")],
            request: { goal: "Готовая задача" }
          }
        ]
      }
    });
  });

  await page.goto(`/?project=${projectId}&view=plan`);
  const workPanel = panel(page);
  const filters = workPanel.getByRole("group", { name: "Фильтр задач Manager" });
  const history = workPanel.getByRole("group", { name: "История задач Manager" });

  await expect(filters.getByRole("button", { name: "Все 4" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Активные 1" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Внимание 2" })).toBeVisible();
  await expect(filters.getByRole("button", { name: "Готовые 1" })).toBeVisible();
  await expect(history.getByRole("button")).toHaveCount(4);

  await filters.getByRole("button", { name: "Внимание 2" }).click();
  await expect(history.getByRole("button")).toHaveCount(2);
  await expect(workPanel.getByTestId("manager-work-stage")).toHaveText("Сохранение файлов");
  await expect(workPanel.getByRole("status")).toContainText("Нужно разрешение");

  resolvedAttention = true;
  await expect(filters.getByRole("button", { name: "Внимание 0" })).toBeVisible({
    timeout: 5_000
  });
  await expect(history.getByRole("button")).toHaveCount(0);
  await expect(history).toContainText("В этой категории пока нет задач.");

  await filters.getByRole("button", { name: "Готовые 2" }).click();
  await expect(history.getByRole("button")).toHaveCount(2);
  await expect(workPanel.getByTestId("manager-work-stage")).toHaveText("Готово");
});
