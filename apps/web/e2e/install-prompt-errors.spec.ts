import { expect, test } from "@playwright/test";

const exposeInstallPrompt = async (
  page: import("@playwright/test").Page,
  mode: "fail" | "dismiss"
): Promise<void> => {
  await expect
    .poll(async () =>
      page.evaluate((promptMode) => {
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            if (promptMode === "fail") {
              throw new Error("internal install failure secret-marker");
            }
          },
          userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
        });
        window.dispatchEvent(event);
        return Boolean(document.querySelector('[aria-label="Установить Cosmora"]'));
      }, mode)
    )
    .toBe(true);
};

test("shows safe install feedback when browser prompt fails", async ({ page }) => {
  await page.goto("/");
  await exposeInstallPrompt(page, "fail");

  const install = page.getByRole("button", { name: "Установить Cosmora" });
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
  await exposeInstallPrompt(page, "dismiss");

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await install.click();
  await expect(install).toHaveCount(0);
});
