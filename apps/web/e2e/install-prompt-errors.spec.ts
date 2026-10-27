import { expect, test, type Page } from "@playwright/test";

const exposeInstallPrompt = async (page: Page, mode: "fail" | "dismissed"): Promise<void> => {
  await expect
    .poll(async () =>
      page.evaluate(async (promptMode) => {
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            if (promptMode === "fail") {
              throw new Error("internal install failure secret-marker");
            }
          },
          userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
        });
        window.dispatchEvent(event);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return Boolean(document.querySelector('[aria-label="Установить Kosmora"]'));
      }, mode)
    )
    .toBe(true);
};

test("shows safe install feedback when browser prompt fails", async ({ page }) => {
  await page.goto("/");
  await exposeInstallPrompt(page, "fail");

  const install = page.getByRole("button", { name: "Установить Kosmora" });
  await expect(install).toBeVisible();
  await install.click();

  const alert = page
    .getByRole("alert")
    .filter({ hasText: "Не удалось открыть установку Kosmora." });
  await expect(alert).toHaveCount(1);
  await expect(page.locator("body")).not.toContainText("internal install failure");
  await expect(page.locator("body")).not.toContainText("secret-marker");
});

test("consumes a dismissed browser install prompt once", async ({ page }) => {
  await page.goto("/");
  await exposeInstallPrompt(page, "dismissed");

  const install = page.getByRole("button", { name: "Установить Kosmora" });
  await expect(install).toBeVisible();
  await install.click();
  await expect(install).toHaveCount(0);
});
