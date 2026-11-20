import { expect, test } from "@playwright/test";

test("prevents rapid duplicate ordinary chat submission", async ({ page }) => {
  let chatPosts = 0;

  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    chatPosts += 1;
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "INTERNAL_DUPLICATE_GUARD secret-chat-submit-marker"
        }
      })
    });
  });

  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Проверка двойной отправки");

  const send = page.getByRole("button", { name: "Отправить", exact: true });
  await expect(send).toBeEnabled();
  await send.evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });

  await expect(
    page.getByRole("alert").filter({ hasText: "Сервис временно недоступен" })
  ).toBeVisible();

  expect(chatPosts).toBe(1);
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Проверка двойной отправки");
  await expect(page.locator("body")).not.toContainText("INTERNAL_DUPLICATE_GUARD");
  await expect(page.locator("body")).not.toContainText("secret-chat-submit-marker");
});
