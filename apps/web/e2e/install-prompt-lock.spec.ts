import { expect, test } from "@playwright/test";

test("locks the browser install prompt against synchronous duplicate clicks", async ({ page }) => {
  await page.goto("/");

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const target = window as Window & {
          __installPromptCalls?: number;
          __resolveInstallPrompt?: () => void;
        };
        target.__installPromptCalls ??= 0;

        if (!document.querySelector('[aria-label="Установить Kosmora"]')) {
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
        }

        return Boolean(document.querySelector('[aria-label="Установить Kosmora"]'));
      })
    )
    .toBe(true);

  const install = page.getByRole("button", { name: "Установить Kosmora" });

  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[aria-label="Установить Kosmora"]');
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
