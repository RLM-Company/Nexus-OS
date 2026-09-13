import { expect, test } from "@playwright/test";

test("publishes an installable standalone app manifest and icons", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
  };
  expect(manifest).toMatchObject({
    name: "Cosmora Manager Console",
    short_name: "Cosmora",
    start_url: "/",
    scope: "/",
    display: "standalone"
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/icon", sizes: "512x512", type: "image/png" }),
      expect.objectContaining({ src: "/apple-icon", sizes: "180x180", type: "image/png" })
    ])
  );

  for (const path of ["/icon", "/apple-icon"]) {
    const icon = await request.get(path);
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/png");
    expect((await icon.body()).byteLength).toBeGreaterThan(1_000);
  }
});

test("keeps the Manager Console usable at a smartphone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Мобильная навигация" })).toBeVisible();
  await expect(page.getByLabel("Опишите результат, который хотите получить")).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустить" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("turns a home suggestion into an editable Manager request", async ({ page }) => {
  await page.goto("/");

  const composer = page.getByLabel("Опишите результат, который хотите получить");
  await page.getByRole("button", { name: /Создать проект/ }).click();

  await expect(composer).toHaveValue("Помоги сформулировать цель нового проекта");
  await expect(composer).toBeFocused();
  await expect(page.getByRole("button", { name: "Запустить" })).toBeEnabled();
});

test("offers the browser install action when the platform exposes it", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const target = window as Window & { __cosmoraInstallPromptCalls?: number };
        target.__cosmoraInstallPromptCalls ??= 0;
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            target.__cosmoraInstallPromptCalls = (target.__cosmoraInstallPromptCalls ?? 0) + 1;
          },
          userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
        });
        window.dispatchEvent(event);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return Boolean(document.querySelector('[aria-label="Установить Cosmora"]'));
      })
    )
    .toBe(true);

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await expect(install).toBeVisible();
  await install.click();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __cosmoraInstallPromptCalls?: number }).__cosmoraInstallPromptCalls
    )
  ).toBe(1);
});
