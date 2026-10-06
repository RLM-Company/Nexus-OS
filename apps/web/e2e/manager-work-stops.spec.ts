import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

const panel = (page: Page) => page.getByRole("region", { name: "Выполнение задачи Manager" });
async function createProject(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Подготовь файл для проверки остановки",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: null } })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) =>
    route.fulfill({ json: null })
  );
});

test("does not create work during a global stop and rechecks clearance", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  let paused = true;
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/work"))
      mutations.push(request.url());
  });
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({
      json: { process_stop: paused ? { active: true, reason: "private-stop-reason" } : null }
    })
  );
  await page.goto(`/?project=${projectId}&view=plan`);
  await expect(panel(page).getByTestId("manager-execution-gate")).toContainText(
    "для всех проектов"
  );
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("link", { name: "Центр управления", exact: true })
  ).toHaveAttribute("href", `/control-center?project=${projectId}`);
  await expect(page.locator("body")).not.toContainText("private-stop-reason");
  expect(mutations).toEqual([]);
  paused = false;
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeEnabled();
  await expect(panel(page).getByTestId("manager-execution-gate")).toHaveCount(0);
  expect(mutations).toEqual([]);
});

test("checks the selected project's stop without blocking unrelated project stops", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  let paused = true;
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({
      json: { process_stop: null, active_project_stops: 9 }
    })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("project_id")).toBe(projectId);
    return route.fulfill({ json: paused ? { active: true } : null });
  });
  await page.goto(`/?project=${projectId}&view=plan`);
  await expect(panel(page).getByTestId("manager-execution-gate")).toContainText(
    "для этого проекта"
  );
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeDisabled();
  paused = false;
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeEnabled();
});

test("unavailable or malformed stop evidence blocks new work without leaking details", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  let unavailable = true;
  let malformed = true;
  await page.route("**/api/v1/operations/status", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "private-stop-service-error" } })
      : route.fulfill({ json: { process_stop: null } })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) =>
    route.fulfill({ json: malformed ? {} : null })
  );
  await page.goto(`/?project=${projectId}&view=plan`);
  await expect(panel(page).getByTestId("manager-execution-gate")).toContainText(
    "Не удалось проверить"
  );
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("private-stop-service-error");
  unavailable = false;
  await page.reload();
  await expect(panel(page).getByTestId("manager-execution-gate")).toContainText(
    "Не удалось проверить"
  );
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeDisabled();
  malformed = false;
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeEnabled();
});

test("blocks resume and plan approval while retaining cancellation", async ({ page, request }) => {
  const projectId = await createProject(request);
  let status = "paused";
  await page.route(`**/api/v1/projects/${projectId}/work`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "fixture-paused-work",
            version: 1,
            status,
            stage: "draft",
            pause_requested: false,
            model_requests: 1,
            error_code: null,
            confirmation_id: null,
            plan: null,
            draft: null,
            review: null,
            events: [],
            request: { goal: "Сохранённая задача" }
          }
        ]
      }
    })
  );
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: { active: true } } })
  );
  await page.goto(`/?project=${projectId}&view=plan`);
  await expect(panel(page).getByRole("button", { name: "Продолжить", exact: true })).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: "Остановить задачу", exact: true })
  ).toBeEnabled();
  status = "awaiting_approval";
  await page.reload();
  await expect(
    panel(page).getByRole("button", { name: "Подтвердить план", exact: true })
  ).toBeDisabled();
  await expect(
    panel(page).getByRole("button", { name: "Остановить задачу", exact: true })
  ).toBeEnabled();
});

test("shows blocked publish work as file-saving attention", async ({ page, request }) => {
  const projectId = await createProject(request);
  await page.route(`**/api/v1/projects/${projectId}/work`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "fixture-blocked-publish",
            version: 4,
            status: "blocked",
            stage: "publish",
            pause_requested: false,
            model_requests: 2,
            error_code: "WAITING_CONFIRMATION",
            confirmation_id: "confirmation-1",
            plan: {
              summary: "Подготовить файл",
              instructions: "Создать результат и сохранить его в проекте",
              complexity: "simple",
              needs_critic: false
            },
            draft: { files: [{ name: "result.md", content: "# Result" }] },
            review: null,
            events: [
              {
                sequence: 1,
                message: "Сохранение файлов ожидает разрешения",
                at: "2026-10-06T07:00:00.000Z"
              }
            ],
            request: { goal: "Сохранить готовый файл" }
          }
        ]
      }
    })
  );

  await page.goto(`/?project=${projectId}&view=plan`);
  const workPanel = panel(page);
  await expect(workPanel.getByTestId("manager-work-stage")).toHaveText("Сохранение файлов");
  const progress = workPanel.getByRole("list", { name: "Прогресс выполнения" });
  await expect(progress.getByRole("listitem").nth(3)).toHaveAttribute("aria-current", "step");
  await expect(
    workPanel.getByRole("link", { name: "Разрешения проекта", exact: true })
  ).toBeVisible();
});

test("bounds a stalled project-stop check while retaining fail-closed launch controls", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  let stalled = true;
  await page.route("**/api/v1/operations/emergency-stop?**", async (route) => {
    if (!stalled) await route.fulfill({ json: null });
  });
  await page.goto(`/?project=${projectId}&view=plan`);
  await expect(panel(page).getByTestId("manager-execution-gate")).toContainText(
    "Не удалось проверить",
    { timeout: 9_000 }
  );
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeDisabled();
  stalled = false;
  await expect(
    panel(page).getByRole("button", { name: "Создать файлы", exact: true })
  ).toBeEnabled();
});
