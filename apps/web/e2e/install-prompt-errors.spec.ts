import { expect, test } from "@playwright/test";

test("shows safe install feedback when browser prompt fails", async ({ page }) => {
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

  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Не удалось открыть установку Cosmora." });
  await expect(alert).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("internal install failure");
  await expect(page.locator("body")).not.toContainText("secret-marker");
});

test("consumes a dismissed browser install prompt once", async ({ page }) => {
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
