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
  await expect(page.getByText("Следующий этап подключит настоящего менеджера")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
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
  expect(restored.status(), await restored.text()).toBe(200);
  await page.locator(".project-list .project-item").first().click();
  await expect(page.locator(".chat-panel .message.user p")).toHaveText(initialTask);
  await expect(page.getByText("Следующий этап подключит настоящего менеджера")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await expect(page.getByRole("region", { name: "Информация о проекте" })).toContainText("A0");

  await page.getByLabel("Сообщение менеджеру").fill("Останови этот тестовый запуск");
  await page.getByRole("button", { name: "Отправить" }).click();
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
  await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
});
