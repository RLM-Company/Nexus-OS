import { expect, test } from "@playwright/test";

test("creates a project, streams, restores history and cancels a run", async ({ page }) => {
  const initialTask = "B0.1: проверь сохранение проекта после перезапуска";

  await page.goto("/");
  await page.getByLabel("Опишите результат, который хотите получить").fill(initialTask);
  const createProject = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") && response.request().method() === "POST"
  );
  const streamResponse = page.waitForResponse(
    (response) => response.url().includes("/api/v1/runs/") && response.url().endsWith("/events")
  );
  await page.getByRole("button", { name: "Запустить" }).click();
  await expect(page.getByRole("status")).toContainText(/В очереди|Менеджер отвечает/);
  const created = await createProject;
  const createdText = await created.text();
  expect(created.status(), createdText).toBe(201);
  const createdBody = JSON.parse(createdText) as { project: { id: string } };
  const stream = await streamResponse;
  expect(stream.status()).toBe(200);

  await expect(page.getByRole("heading", { name: initialTask })).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Главный чат проекта" })
      .getByText("Следующий этап подключит настоящего менеджера")
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Главный чат проекта" })
      .getByText("Последний ответ: mock · manager-b0.1")
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await expect(page).toHaveURL(new RegExp(`project=${createdBody.project.id}&view=chat`));
  await page.getByRole("tab", { name: "Проект" }).click();
  await expect(page).toHaveURL(new RegExp(`project=${createdBody.project.id}&view=project`));
  const projectFacts = page.getByRole("region", { name: "Информация о проекте" });
  await expect(projectFacts).toContainText("Активен");
  await expect(projectFacts).toContainText("A0");
  await expect(projectFacts).toContainText("Решения владельца");
  await expect(projectFacts).toContainText("Нет");
  await expect(projectFacts).toContainText("Recovery");
  await expect(projectFacts).toContainText("Не требуется");
  await expect(projectFacts).toContainText("Сообщений");
  await expect(page.getByRole("link", { name: "Control Center" })).toHaveAttribute(
    "href",
    `/control-center?project=${createdBody.project.id}`
  );
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);

  const restoredProjects = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") && response.request().method() === "GET"
  );
  await page.reload();
  const restored = await restoredProjects;
  expect(restored.status()).toBe(200);
  await expect(page.getByRole("heading", { name: initialTask })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Проект" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Информация о проекте" })).toContainText("A0");
  await page.getByRole("tab", { name: "Чат" }).click();
  await expect(page.locator(".chat-panel .message.user p")).toHaveText(initialTask);
  await expect(
    page
      .getByRole("region", { name: "Главный чат проекта" })
      .getByText("Следующий этап подключит настоящего менеджера")
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await page.getByLabel("Сообщение менеджеру").fill("Останови этот тестовый запуск");
  const acceptedRun = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/projects/${createdBody.project.id}/messages`) &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Отправить" }).click();
  const accepted = await acceptedRun;
  const acceptedText = await accepted.text();
  expect(accepted.status(), acceptedText).toBe(202);
  const acceptedBody = JSON.parse(acceptedText) as { run_id: string };
  await expect(page.getByRole("status")).toContainText(/В очереди|Менеджер отвечает/);

  const projectsAfterReload = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") && response.request().method() === "GET"
  );
  const reconnectedStream = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/runs/${acceptedBody.run_id}/events`) &&
      response.request().method() === "GET"
  );
  await page.reload();
  const [reloadedProjects, reconnected] = await Promise.all([
    projectsAfterReload,
    reconnectedStream
  ]);
  expect(reloadedProjects.status()).toBe(200);
  expect(reconnected.status()).toBe(200);

  await expect(page.getByRole("status")).toContainText(/В очереди|Менеджер отвечает/);
  const cancel = page.getByRole("button", { name: "Остановить" });
  await expect(cancel).toBeEnabled();
  const cancelResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/runs/") &&
      response.url().endsWith("/cancel") &&
      response.request().method() === "POST"
  );
  const cancelledDetail = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/projects/${createdBody.project.id}`) &&
      response.request().method() === "GET"
  );
  await cancel.click();

  const cancelled = await cancelResponse;
  expect(cancelled.status(), await cancelled.text()).toBe(200);
  const detail = await cancelledDetail;
  const detailText = await detail.text();
  expect(detail.status(), detailText).toBe(200);
  expect(
    (JSON.parse(detailText) as { messages: Array<{ status: string }> }).messages.some(
      (message) => message.status === "cancelled"
    )
  ).toBe(true);

  await expect(page.getByText("Запуск остановлен владельцем.")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Остановлен/);
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  const restoreDraft = page.getByRole("button", { name: "Вернуть запрос в редактор" });
  await expect(restoreDraft).toBeVisible();
  const replayRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") replayRequests.push(request.url());
  });
  await restoreDraft.click();
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("Останови этот тестовый запуск");
  await expect(page.getByLabel("Сообщение менеджеру")).toBeFocused();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  expect(replayRequests).toEqual([]);
});

test("surfaces server-confirmed owner decisions and recovery in the Manager Console", async ({
  page
}) => {
  await page.route(
    (url) =>
      url.pathname.endsWith("/confirmations") && url.searchParams.get("status") === "PENDING",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              confirmation_id: "confirmation-alpha",
              operation_id: "operation-alpha",
              intent: {
                capability_ids: ["external.communicate"],
                purpose: "Отправить отчёт demo@example.com"
              },
              requires_step_up: false,
              expires_at: "2030-01-01T12:00:00.000Z"
            }
          ]
        })
      });
    }
  );
  await page.route(
    (url) => url.pathname.endsWith("/recovery-required") && url.searchParams.get("limit") === "50",
    async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              operation_id: "operation-recovery-alpha",
              capability_ids: ["production.deploy"],
              reasons: ["Result evidence is missing"],
              reserved_at: "2030-01-01T11:00:00.000Z"
            }
          ],
          limit: 50
        })
      });
    }
  );

  await page.goto("/");
  await page
    .getByLabel("Опишите результат, который хотите получить")
    .fill("Project Alpha: проверь карточки решений");
  const createdProject = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Запустить" }).click();
  const created = await createdProject;
  const createdText = await created.text();
  expect(created.status(), createdText).toBe(201);
  const createdBody = JSON.parse(createdText) as { project: { id: string } };

  await page.getByRole("tab", { name: /Проект/ }).click();
  const attention = page.getByRole("region", { name: "Требуется внимание владельца" });
  await expect(attention).toBeVisible({ timeout: 10_000 });
  await expect(attention).toContainText("Отправить отчёт demo@example.com");
  await expect(attention).toContainText("Внешний результат неизвестен");
  await expect(attention.getByRole("link", { name: "Проверить решение" })).toHaveAttribute(
    "href",
    `/control-center?project=${createdBody.project.id}#pending-confirmations`
  );
  await expect(attention.getByRole("link", { name: "Сверить recovery" })).toHaveAttribute(
    "href",
    `/control-center?project=${createdBody.project.id}#policy-recovery-required-title`
  );
});
