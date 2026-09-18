import { expect, test } from "@playwright/test";

test("Agent Studio load errors are announced as alerts", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "internal marker must stay hidden" } })
    });
  });

  await page.goto("/agent-studio?project=accessibility-fixture");

  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Сервис временно недоступен. Повторите попытку." });
  await expect(alert).toHaveCount(1);
  await expect(alert).not.toContainText("internal marker must stay hidden");
});
