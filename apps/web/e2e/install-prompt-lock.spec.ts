import { expect, test } from "@playwright/test";

test("locks the browser install prompt against synchronous duplicate clicks", async ({ page }) => {
  await page.goto("/");

  await page.evaluate(() => {
    const target = window as Window & {
      __installPromptCalls?: number;
      __resolveInstallPrompt?: () => void;
    };
    target.__installPromptCalls = 0;

    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => {
        target.__installPromptCalls = (target.__installPromptCalls ?? 0) + 1;
        return new Promise<void>((resolve) => {
          target.__resolveInstallPrompt = resolve;
        });
      },
      userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
    });
    window.dispatchEvent(event);
  });

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await expect(install).toBeVisible();

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Установить Cosmora"]');
    button?.click();
    button?.click();
  });

  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __installPromptCalls?: number }).__installPromptCalls ?? 0
      )
    )
    .toBe(1);
  await expect(install).toBeDisabled();

  await page.evaluate(() => {
    const target = window as Window & { __resolveInstallPrompt?: () => void };
    target.__resolveInstallPrompt?.();
  });

  await expect(install).toHaveCount(0);
});
