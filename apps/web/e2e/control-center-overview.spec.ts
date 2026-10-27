import { expect, test, type Page } from "@playwright/test";

const operations = {
  generated_at: "2026-10-01T00:00:00Z",
  process_stop: { active: true, activated_by: "system:environment", reason: "private-stop-reason" },
  active_runs: 0,
  active_project_stops: 2,
  metrics: { route_attempts: 7 }
};
const overview = (page: Page) => page.getByRole("region", { name: "Общее состояние запросов" });

test("shows the global stop and metrics without requiring a project or starting work", async ({
  page
}) => {
  const mutations: string[] = [];
  const projectRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && request.method() !== "GET")
      mutations.push(request.url());
    if (request.url().includes("/api/v1/projects")) projectRequests.push(request.url());
  });
  await page.route("**/api/v1/operations/status", (route) => route.fulfill({ json: operations }));
  await page.goto("/control-center");
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveText(
    "Запросы приостановлены"
  );
  await expect(overview(page)).toContainText("Остановка задана настройкой сервера");
  await expect(overview(page).getByTestId("overview-route-attempts")).toHaveText("7");
  await expect(overview(page)).toContainText("счётчик обнуляется при перезапуске");
  await expect(page.getByRole("heading", { name: "Выберите проект" })).toBeVisible();
  await expect(overview(page).getByRole("link", { name: "Подключение модели" })).toHaveAttribute(
    "href",
    "/model-status"
  );
  await expect(page.locator("body")).not.toContainText("private-stop-reason");
  expect(mutations).toEqual([]);
  expect(projectRequests).toEqual([]);
});

test("refreshes stop clearance without claiming live model readiness", async ({ page }) => {
  let paused = true;
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({
      json: { ...operations, process_stop: paused ? operations.process_stop : null }
    })
  );
  await page.goto("/control-center");
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveText(
    "Запросы приостановлены"
  );
  paused = false;
  await overview(page).getByRole("button", { name: "Обновить сводку" }).click();
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveText("Не активна");
  await expect(overview(page)).toContainText("не подтверждает подключение модели");
  await expect(overview(page)).not.toContainText("Готово к запуску");
});

test("fails closed on unavailable status and retries without revealing server details", async ({
  page
}) => {
  let unavailable = true;
  await page.route("**/api/v1/operations/status", (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { error: "private-response-detail" } })
      : route.fulfill({ json: operations })
  );
  await page.goto("/control-center");
  await expect(overview(page).getByRole("alert")).toContainText("Сервис временно недоступен");
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("private-response-detail");
  unavailable = false;
  await overview(page).getByRole("button", { name: "Обновить сводку" }).click();
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveText(
    "Запросы приостановлены"
  );
});

test("rejects missing stop state or invalid counters instead of displaying a clear state", async ({
  page
}) => {
  let response: unknown = {};
  await page.route("**/api/v1/operations/status", (route) => route.fulfill({ json: response }));
  await page.goto("/control-center");
  await expect(overview(page).getByRole("alert")).toContainText(
    "Не удалось получить общее состояние"
  );
  response = { ...operations, process_stop: null, metrics: { route_attempts: -1 } };
  await overview(page).getByRole("button", { name: "Обновить сводку" }).click();
  await expect(overview(page).getByRole("alert")).toContainText(
    "Не удалось получить общее состояние"
  );
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveCount(0);
});

test("keeps the overview within mobile and desktop viewports", async ({ page }) => {
  await page.route("**/api/v1/operations/status", (route) => route.fulfill({ json: operations }));
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/control-center");
    await expect(overview(page).getByTestId("overview-process-stop")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBeTruthy();
  }
});

test("bounds a stalled status request and permits manual refresh", async ({ page }) => {
  let stalled = true;
  await page.route("**/api/v1/operations/status", async (route) => {
    if (!stalled) await route.fulfill({ json: operations });
  });
  await page.goto("/control-center");
  await expect(overview(page).getByRole("alert")).toContainText(
    "Не удалось получить общее состояние",
    { timeout: 9_000 }
  );
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveCount(0);
  stalled = false;
  await overview(page).getByRole("button", { name: "Обновить сводку" }).click();
  await expect(overview(page).getByTestId("overview-process-stop")).toHaveText(
    "Запросы приостановлены"
  );
});
