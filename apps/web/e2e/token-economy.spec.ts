import { expect, test } from "@playwright/test";

test("saves the explicit token economy choice without enabling it by default", async ({ page }) => {
  let enabled = false;
  await page.route("**/api/v1/settings/token-economy", async (route) => {
    if (route.request().method() === "PUT") {
      enabled = (route.request().postDataJSON() as { enabled: boolean }).enabled;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled })
    });
  });

  await page.goto("/settings");
  const toggle = page.getByRole("switch");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Контекстный компрессор")).toBeVisible();

  await page.reload();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});
