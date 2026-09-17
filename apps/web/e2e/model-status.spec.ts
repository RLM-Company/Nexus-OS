import { expect, test, type Page } from "@playwright/test";

type RuntimeOverrides = Partial<{
  mode: string;
  provider: string;
  model: string;
  credential_configured: boolean;
  fallback_to_mock: boolean;
  registry_version: string;
  updated_at: string;
}>;

const runtime = (overrides: RuntimeOverrides = {}) => ({
  mode: "mock",
  provider: "mock",
  model: "manager-b0.1",
  credential_configured: false,
  fallback_to_mock: false,
  registry_version: "test-registry",
  updated_at: "2026-09-17T20:00:00.000Z",
  ...overrides
});

const fulfillRuntime = async (page: Page, overrides: RuntimeOverrides = {}) => {
  await page.route("**/api/v1/model-runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(runtime(overrides))
    });
  });
};

const detail = (page: Page, label: string) =>
  page.locator("div").filter({ has: page.locator("dt", { hasText: label }) }).last();

test("shows mock mode without exposing a credential", async ({ page }) => {
  await fulfillRuntime(page);
  await page.goto("/model-status");

  await expect(page.getByText("Mock-режим активен")).toBeVisible();
  await expect(detail(page, "Режим")).toContainText("Mock");
  await expect(detail(page, "Provider")).toContainText("mock");
  await expect(detail(page, "Credential configured")).toContainText("Нет");
  await expect(detail(page, "Mock fallback разрешён")).toContainText("Нет");
  await expect(page.getByRole("link", { name: "Локальная инструкция настройки" })).toHaveAttribute(
    "href",
    "/live-model-setup.md"
  );
});

test("shows a fail-closed live route as configured", async ({ page }) => {
  await fulfillRuntime(page, {
    mode: "external",
    provider: "openai-compatible",
    model: "gpt-5.5",
    credential_configured: true,
    fallback_to_mock: false
  });
  await page.goto("/model-status");

  await expect(page.getByText("Live-провайдер настроен")).toBeVisible();
  await expect(detail(page, "Режим")).toContainText("Live");
  await expect(detail(page, "Credential configured")).toContainText("Да");
  await expect(detail(page, "Fail-closed route")).toContainText("Да");
});

test("does not call live configured while automatic mock fallback is enabled", async ({ page }) => {
  await fulfillRuntime(page, {
    mode: "external",
    provider: "openai-compatible",
    model: "gpt-5.5",
    credential_configured: true,
    fallback_to_mock: true
  });
  await page.goto("/model-status");

  await expect(page.getByText("Live заблокирован безопасностью")).toBeVisible();
  await expect(detail(page, "Mock fallback разрешён")).toContainText("Да");
  await expect(detail(page, "Fail-closed route")).toContainText("Нет");
  await expect(page.getByText("Live-провайдер настроен")).toHaveCount(0);
});

test("shows a live provider as not configured when the key is absent", async ({ page }) => {
  await fulfillRuntime(page, {
    mode: "external",
    provider: "openai-compatible",
    model: "gpt-5.5",
    credential_configured: false,
    fallback_to_mock: false
  });
  await page.goto("/model-status");

  await expect(page.getByText("Live-провайдер не настроен полностью")).toBeVisible();
  await expect(detail(page, "Credential configured")).toContainText("Нет");
});

for (const scenario of [
  { status: 401, title: "Требуется авторизация" },
  { status: 403, title: "Доступ запрещён" },
  { status: 429, title: "Слишком много запросов" },
  { status: 503, title: "Локальный API временно недоступен" }
]) {
  test(`shows a safe ${scenario.status} status without upstream details`, async ({ page }) => {
    await page.route("**/api/v1/model-runtime", async (route) => {
      await route.fulfill({
        status: scenario.status,
        contentType: "application/json",
        body: JSON.stringify({
          error: "INTERNAL_RESPONSE_SENTINEL",
          provider_headers: "INTERNAL_HEADER_SENTINEL"
        })
      });
    });

    await page.goto("/model-status");

    await expect(page.getByText(scenario.title)).toBeVisible();
    await expect(page.getByText("INTERNAL_RESPONSE_SENTINEL")).toHaveCount(0);
    await expect(page.getByText("INTERNAL_HEADER_SENTINEL")).toHaveCount(0);
  });
}

test("shows a safe error for malformed status payloads", async ({ page }) => {
  await page.route("**/api/v1/model-runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ raw_provider_error: "INTERNAL_RESPONSE_SENTINEL" })
    });
  });

  await page.goto("/model-status");

  await expect(page.getByText("Получен неожиданный ответ")).toBeVisible();
  await expect(page.getByText("INTERNAL_RESPONSE_SENTINEL")).toHaveCount(0);
});

test("times out locally without surfacing a delayed response body", async ({ page }) => {
  await page.route("**/api/v1/model-runtime", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    await route.fulfill({
      status: 500,
      contentType: "text/plain",
      body: "INTERNAL_RESPONSE_SENTINEL"
    });
  });

  await page.goto("/model-status");

  await expect(page.getByText("API не ответил вовремя")).toBeVisible({ timeout: 7_000 });
  await expect(page.getByText("INTERNAL_RESPONSE_SENTINEL")).toHaveCount(0);
});

test("retry recovers after a temporary server failure", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/v1/model-runtime", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        runtime({
          mode: "external",
          provider: "openai-compatible",
          credential_configured: true,
          fallback_to_mock: false
        })
      )
    });
  });

  await page.goto("/model-status");
  await expect(page.getByText("Локальный API временно недоступен")).toBeVisible();

  await page.getByRole("button", { name: "Проверить снова" }).click();
  await expect(page.getByText("Live-провайдер настроен")).toBeVisible();
  expect(attempts).toBe(2);
});

test("shows offline state and refreshes automatically after reconnect", async ({ page, context }) => {
  await fulfillRuntime(page, {
    mode: "external",
    provider: "openai-compatible",
    credential_configured: true,
    fallback_to_mock: false
  });
  await page.goto("/model-status");
  await expect(page.getByText("Live-провайдер настроен")).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("Нет соединения")).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Live-провайдер настроен")).toBeVisible();
});
