import { expect, test } from "@playwright/test";

const rawSecret =
  "INTERNAL_PROVIDER_FAILURE Authorization: Bearer owner-secret-debug-marker";

const installServerFailure = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: rawSecret
        }
      })
    });
  });
};

test("Control Center redacts raw API error details", async ({ page }) => {
  await installServerFailure(page);
  await page.goto("/control-center?project=redaction-fixture");

  await expect(page.getByText("Сервис временно недоступен. Повторите попытку.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("INTERNAL_PROVIDER_FAILURE");
  await expect(page.locator("body")).not.toContainText("owner-secret-debug-marker");
  await expect(page.locator("body")).not.toContainText("Authorization: Bearer");
});

test("Agent Studio redacts raw API error details", async ({ page }) => {
  await installServerFailure(page);
  await page.goto("/agent-studio?project=redaction-fixture");

  await expect(page.getByText("Сервис временно недоступен. Повторите попытку.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("INTERNAL_PROVIDER_FAILURE");
  await expect(page.locator("body")).not.toContainText("owner-secret-debug-marker");
  await expect(page.locator("body")).not.toContainText("Authorization: Bearer");
});
