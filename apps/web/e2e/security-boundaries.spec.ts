import { expect, test } from "@playwright/test";

test("redacts internal API error details and offers retry", async ({ page }) => {
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { message: "INTERNAL_PROVIDER_TIMEOUT Authorization: Bearer secret-debug-marker" }
      })
    });
  });

  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Проверка безопасной ошибки");
  await page.getByRole("button", { name: "Отправить" }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Сервис Cosmora временно недоступен" });
  await expect(alert).toBeVisible();
  await expect(page.getByRole("button", { name: "Повторить" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("INTERNAL_PROVIDER_TIMEOUT");
  await expect(page.locator("body")).not.toContainText("secret-debug-marker");
  await expect(page.locator("body")).not.toContainText("Bearer");
});

test("fails closed when the API returns an external stream URL", async ({ page }) => {
  const externalRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://outside.example/")) externalRequests.push(request.url());
  });

  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const now = "2026-09-18T00:00:00.000Z";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        chat: { id: "safe-chat", title: "Safe chat", created_at: now, updated_at: now },
        user_message: {
          id: "safe-message",
          chat_id: "safe-chat",
          role: "user",
          content_type: "text",
          content: "Проверка URL",
          status: "completed",
          run_id: "safe-run",
          error_code: null,
          created_at: now,
          updated_at: now
        },
        run_id: "safe-run",
        stream_url: "https://outside.example/events"
      })
    });
  });

  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Проверка URL");
  await page.getByRole("button", { name: "Отправить" }).click();

  await expect(page.getByRole("alert")).toContainText("Не удалось безопасно открыть поток ответа");
  expect(externalRequests).toEqual([]);
});

test("prevents rapid duplicate project confirmation", async ({ page }) => {
  let projectPosts = 0;
  await page.route("**/api/v1/projects", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    projectPosts += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "secret-project-error" } })
    });
  });

  await page.goto("/");
  await page
    .getByLabel("Сообщение Cosmora")
    .fill("Создай проект: разработай приложение с API, базой данных, интерфейсом и e2e-тестами");
  await page.getByRole("button", { name: "Отправить" }).click();

  const proposal = page.getByRole("complementary", { name: "Предложение создать проект" });
  const confirm = proposal.getByRole("button", { name: "Оформить как проект" });
  await expect(confirm).toBeVisible();
  await confirm.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(page.getByRole("alert")).toContainText("Сервис Cosmora временно недоступен");
  expect(projectPosts).toBe(1);
  await expect(page.locator("body")).not.toContainText("secret-project-error");
});
