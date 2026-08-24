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
  const created = await createProject;
  expect(created.status(), await created.text()).toBe(201);
  const stream = await streamResponse;
  expect(stream.status()).toBe(200);

  await expect(page.getByRole("heading", { name: initialTask })).toBeVisible();
  await expect(page.getByText("Следующий этап подключит настоящего менеджера")).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);

  await page.reload();
  await page.locator(".project-list .project-item").first().click();
  await expect(page.getByText(initialTask, { exact: true })).toBeVisible();
  await expect(page.getByText("Следующий этап подключит настоящего менеджера")).toBeVisible();

  await page.getByLabel("Сообщение менеджеру").fill("Останови этот тестовый запуск");
  await page.getByRole("button", { name: "Отправить" }).click();
  const cancel = page.getByRole("button", { name: "Остановить" });
  await expect(cancel).toBeEnabled();
  await cancel.click();

  await expect(page.getByText("Запуск остановлен владельцем.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
});
