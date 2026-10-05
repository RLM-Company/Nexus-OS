import { expect, test } from "@playwright/test";

test("shows real Manager stages, current activity and budget without extra mutations", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Подготовь план запуска продукта",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  const work = {
    id: "work-cockpit-fixture",
    version: 4,
    status: "running",
    stage: "review",
    pause_requested: false,
    model_requests: 2,
    error_code: null,
    confirmation_id: null,
    request: { goal: "Подготовь план запуска продукта" },
    plan: {
      summary: "План запуска",
      instructions: "Собрать структуру, подготовить черновик и проверить результат.",
      complexity: "complex",
      needs_critic: true
    },
    draft: {
      files: [{ name: "launch-plan.md", content: "# План запуска" }]
    },
    review: null,
    events: [
      {
        sequence: 1,
        stage: "plan",
        message: "Manager подготовил план",
        at: "2026-10-05T10:00:00.000Z"
      },
      {
        sequence: 2,
        stage: "draft",
        message: "Аналитик подготовил черновик",
        at: "2026-10-05T10:01:00.000Z"
      },
      {
        sequence: 3,
        stage: "review",
        message: "Критик проверяет черновик",
        at: "2026-10-05T10:02:00.000Z"
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
  const cockpit = panel.getByRole("group", { name: "Состояние выполнения Manager" });
  await expect(cockpit).toBeVisible();

  const metrics = cockpit.locator(".manager-work-metrics");
  await expect(metrics).toContainText("Этап");
  await expect(metrics).toContainText("Проверка");
  await expect(metrics).toContainText("Mock");
  await expect(metrics).toContainText("2 / 3");
  await expect(metrics).toContainText("1 файл");

  const stages = cockpit.getByRole("list", { name: "Этапы выполнения Manager" });
  await expect(stages.getByRole("listitem")).toHaveCount(5);
  await expect(stages.locator('[data-state="complete"]')).toHaveCount(2);
  await expect(stages.locator('[aria-current="step"]')).toHaveText("Проверка");
  await expect(stages.locator('[data-state="pending"]')).toHaveCount(2);

  const current = cockpit.getByTestId("manager-current-activity");
  await expect(current).toContainText("Критик проверяет черновик");
  await expect(current).toContainText("Проверка");

  const events = panel.getByRole("list", { name: "Шаги выполнения" });
  await expect(events.getByRole("listitem")).toHaveCount(3);
  await expect(events.locator('li[data-current="true"]')).toContainText(
    "Критик проверяет черновик"
  );
  await expect(events.locator('li[data-current="true"]')).toContainText("Проверка");

  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);

  expect(mutations).toEqual([]);
});
