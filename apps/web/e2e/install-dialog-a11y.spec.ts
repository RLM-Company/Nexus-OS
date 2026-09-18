import { expect, test } from "@playwright/test";

test("keeps the iOS install help keyboard-accessible", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
    });
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      get: () => "iPhone"
    });
    Object.defineProperty(window.navigator, "maxTouchPoints", {
      configurable: true,
      get: () => 5
    });
  });

  await page.goto("/");

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await expect(install).toBeVisible();
  await install.click();

  const dialog = page.getByRole("dialog", { name: "Добавить Cosmora на экран «Домой»" });
  const understood = dialog.getByRole("button", { name: "Понятно" });
  await expect(understood).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(install).toBeFocused();

  await install.click();
  await page.getByRole("button", { name: "Закрыть подсказку" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(install).toBeFocused();
});
