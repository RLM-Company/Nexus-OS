import { expect, test } from "@playwright/test";

test("keeps the Manager Console usable when localStorage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("local storage blocked", "SecurityError");
      }
    });
  });

  await page.goto("/");

  await expect(page.locator(".topbar h1")).toHaveText("Новый чат");
  await expect(page.getByLabel("Сообщение Cosmora")).toBeVisible();

  const sidebar = page.locator(".sidebar-tools");
  await sidebar.getByRole("button", { name: "Work", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Work");

  await sidebar.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Code");

  await expect(page.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
});
