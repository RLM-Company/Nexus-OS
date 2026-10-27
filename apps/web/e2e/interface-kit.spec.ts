import { expect, test } from "@playwright/test";

test("branded profile selection uses fresh execution version without overwriting Relay preferences", async ({
  page
}) => {
  let version = 1;
  let saved: Record<string, unknown> | null = null;
  let preferenceWrites = 0;
  await page.route("**/api/v1/personal-settings", async (route) => {
    if (route.request().method() === "PUT") {
      preferenceWrites++;
      await route.abort();
      return;
    }
    await route.fulfill({
      json: {
        settings: {
          version,
          relay_enabled: version > 1,
          response_language: "ru",
          optimize_for: "balanced",
          preferred_provider: null,
          preferred_model: null,
          chat_style: "standard",
          max_total_tokens: null,
          updated_at: "2026-10-10"
        },
        available_models: [
          { provider: "fixture", model: "fixture-model", capabilities: { streaming: true } }
        ],
        execution: { version, model_profile: "mercurius", autonomy: 2, turbo: false },
        profiles: [
          { id: "mercurius", name: "Kosmora Mercurius", description: "Быстрый профиль" },
          { id: "mars", name: "Kosmora Mars", description: "Рабочий профиль" }
        ]
      }
    });
  });
  await page.route("**/api/v1/personal-settings/execution", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { execution: { ...saved, version: ++version } } });
  });
  await page.goto("/interface-kit");
  await expect(page.getByLabel("Выбор модели")).toHaveAttribute("aria-disabled", "false");
  await page.getByLabel("Выбор модели").click();
  const mars = page.getByRole("button", { name: /Kosmora Mars/ });
  await expect(mars).toBeEnabled();
  version = 2;
  await mars.click();
  await expect(page.getByLabel("Выбор модели")).toContainText("Kosmora Mars");
  expect(saved).toMatchObject({
    expected_version: 2,
    model_profile: "mars",
    autonomy: 2,
    turbo: false
  });
  expect(preferenceWrites).toBe(0);
  expect(saved).not.toHaveProperty("relay_enabled");
  expect(saved).not.toHaveProperty("updated_at");
  expect(saved).not.toHaveProperty("version");
  await page.getByLabel("Выбор модели").click();
  await page.getByLabel("Выбор модели").press("Escape");
  await expect(mars).not.toBeVisible();
});

test("file tree supports collapse, arrows and selection without leaving the page", async ({
  page
}) => {
  await page.goto("/interface-kit");
  const tree = page.getByRole("tree");
  const folder = tree.getByRole("treeitem", { name: "src", exact: true });
  await folder.click();
  await expect(tree.getByRole("treeitem", { name: "src/app.ts", exact: true })).toHaveCount(0);
  await folder.press("ArrowRight");
  await expect(tree.getByRole("treeitem", { name: "src/app.ts", exact: true })).toBeVisible();
  await folder.press("ArrowRight");
  await expect(tree.getByRole("treeitem", { name: "src/app.ts", exact: true })).toBeFocused();
  await tree.getByRole("treeitem", { name: "src/app.ts", exact: true }).press("ArrowDown");
  await tree.getByRole("treeitem", { name: "src/styles.css", exact: true }).press("Enter");
  await expect(page.getByText("Выбрано: src/styles.css", { exact: true })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "src/styles.css", exact: true })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await page.getByRole("switch", { name: "Пример переключателя" }).check();
  await expect(page.getByRole("switch")).toBeChecked();
});

test("result tabs copy the selected real content and respond to keyboard navigation", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/interface-kit");
  await page.getByRole("tab", { name: "app.ts", exact: true }).press("ArrowRight");
  await expect(page.getByRole("tabpanel")).toContainText("# Kosmora");
  await page.getByRole("button", { name: "Копировать содержимое файла" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Одно пространство для работы."
  );
  await page.getByRole("tab", { name: "README.md", exact: true }).press("Home");
  await expect(page.getByRole("tabpanel")).toContainText('export const greeting = "Kosmora";');
});

test("mobile components fit the viewport and reduced motion disables decorative animation", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/interface-kit");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const shimmer = page.getByText("Подготавливаю ответ…", { exact: true });
  expect(await shimmer.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.screenshot({ path: "../../qa/interface-kit-mobile.png", fullPage: true });
});

test("new chat keeps attachment and composer layout at desktop and mobile widths", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  await expect(page.getByLabel("Выбор модели")).toBeVisible();
  await expect(page.locator(".composer").getByRole("switch")).toHaveCount(0);
  await page.getByLabel("Голосовой ввод", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Диктовать в браузере" })).toBeVisible();
  await page.getByLabel("Голосовой ввод", { exact: true }).press("Escape");
  await expect(page.getByRole("button", { name: "Диктовать в браузере" })).not.toBeVisible();
  await page.screenshot({ path: "../../qa/kosmora-interface-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByLabel("Сообщение Kosmora")).toBeVisible();
  await page.screenshot({ path: "../../qa/kosmora-interface-mobile.png", fullPage: true });
});
