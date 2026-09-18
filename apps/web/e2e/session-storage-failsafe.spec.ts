import { expect, test } from "@playwright/test";

test("keeps the ordinary chat usable when sessionStorage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("session storage blocked", "SecurityError");
      }
    });
  });

  await page.goto("/");

  await expect(page.locator(".topbar .eyebrow")).toHaveText("Обычный чат");
  await expect(page.locator(".hero h2")).not.toBeEmpty();
  await expect(page.getByLabel("Сообщение Cosmora")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
});
