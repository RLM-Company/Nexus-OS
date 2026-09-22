import { expect, test } from "@playwright/test";

test("keeps Login a credential-free provider preview", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Вход в Cosmora" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Telegram" })).toBeDisabled();
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.locator("input")).toHaveCount(0);
  await expect(page.locator("textarea")).toHaveCount(0);
  await expect(page.locator('a[href^="http"]')).toHaveCount(0);
  await expect(page.getByLabel("Статус верификации")).toContainText("Ожидает");
});

test("keeps Login usable without horizontal overflow at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  await expect(page.getByRole("link", { name: "← Настройки" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Вернуться в Cosmora" })).toBeVisible();
  await expect(page.getByLabel("Статус верификации")).toBeVisible();
});

test("skips disabled provider previews in keyboard tab order", async ({ page }) => {
  await page.goto("/login");

  const settingsLink = page.getByRole("link", { name: "← Настройки" });
  const homeLink = page.getByRole("link", { name: "Вернуться в Cosmora" });

  await page.keyboard.press("Tab");
  await expect(settingsLink).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(homeLink).toBeFocused();
});
