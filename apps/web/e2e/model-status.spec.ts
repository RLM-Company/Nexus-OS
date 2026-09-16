import { expect, test, type Page } from "@playwright/test";

const disconnectedRuntime = {
  mode: "mock",
  provider: "mock",
  model: "mock-manager",
  registry_version: "test-registry",
  credential_configured: false,
  fallback_to_mock: false
} as const;

const readyRuntime = {
  mode: "openai-compatible",
  provider: "demo-provider",
  model: "demo-model",
  registry_version: "test-registry",
  credential_configured: true,
  fallback_to_mock: false
} as const;

const mockRuntimeRequest = async (
  page: Page,
  runtime: typeof disconnectedRuntime | typeof readyRuntime
): Promise<void> => {
  await page.route("**/api/v1/model-runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runtime)
    });
  });
};

test("shows the disconnected model state from model runtime", async ({ page }) => {
  await mockRuntimeRequest(page, disconnectedRuntime);
  await page.goto("/model-status");

  await expect(page.getByRole("heading", { name: "Подключение модели" })).toBeVisible();
  await expect(page.getByTestId("runtime-readiness")).toContainText("Модель не подключена");
  await expect(page.getByTestId("runtime-mode")).toHaveText("Mock");
  await expect(page.getByTestId("runtime-provider")).toHaveText("mock");
  await expect(page.getByTestId("runtime-model")).toHaveText("mock-manager");
  await expect(page.getByTestId("runtime-credential")).toHaveText("Нет");
  await expect(page.getByTestId("runtime-fallback")).toHaveText("Нет");
});

test("shows the ready model state when an external credential is configured", async ({ page }) => {
  await mockRuntimeRequest(page, readyRuntime);
  await page.goto("/model-status");

  await expect(page.getByTestId("runtime-readiness")).toContainText("Готово к запуску");
  await expect(page.getByTestId("runtime-mode")).toHaveText("OpenAI-compatible");
  await expect(page.getByTestId("runtime-provider")).toHaveText("demo-provider");
  await expect(page.getByTestId("runtime-model")).toHaveText("demo-model");
  await expect(page.getByTestId("runtime-credential")).toHaveText("Да");
  await expect(page.getByTestId("runtime-fallback")).toHaveText("Нет");
});

test("keeps the model status page within the viewport on mobile and desktop", async ({ page }) => {
  await mockRuntimeRequest(page, readyRuntime);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/model-status");
    await expect(page.getByTestId("model-runtime-card")).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});
