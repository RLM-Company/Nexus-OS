import { expect, test } from "@playwright/test";

test("advertises the light viewport scheme used by the UI", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute("content", "light");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#ffffff");
});
