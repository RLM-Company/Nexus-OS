import { expect, test } from "@playwright/test";

test("falls back safely from an invalid persisted workspace surface", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cosmora:workspace-surface", "javascript:invalid-surface");
  });

  await page.goto("/");

  await expect(page.locator(".topbar h1")).toHaveText("Cosmora Manager");
  await expect
    .poll(async () => page.evaluate(() => window.localStorage.getItem("cosmora:workspace-surface")))
    .toBe("manager");
});
