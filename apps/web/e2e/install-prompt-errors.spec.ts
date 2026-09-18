import { expect, test } from "@playwright/test";

test("shows safe feedback when the browser install prompt fails", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => {
        throw new Error("internal install failure secret-marker");
      },
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
    });
    window.dispatchEvent(event);
  });

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await expect(install).toBeVisible();
  await install.click();

  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "Не удалось открыть установку Cosmora. Используйте меню браузера и повторите попытку."
      })
  ).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("internal install failure");
  await expect(page.locator("body")).not.toContainText("secret-marker");
});

test("treats a dismissed browser install prompt as one-shot", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
    });
    window.dispatchEvent(event);
  });

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await expect(install).toBeVisible();
  await install.click();
  await expect(install).toHaveCount(0);
});
