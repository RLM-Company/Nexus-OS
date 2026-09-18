import { expect, test } from "@playwright/test";

const project = {
  id: "context-alpha",
  title: "Project Context Alpha",
  status: "ACTIVE",
  created_at: "2026-09-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z"
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;

    if (path === "/api/v1/projects") {
      body = { items: [{ ...project, last_message_preview: "Контекст проекта" }] };
    } else if (path === "/api/v1/chats") {
      body = { items: [] };
    } else if (path === "/api/v1/model-runtime") {
      body = {
        mode: "mock",
        provider: "mock",
        model: "fixture",
        credential_configured: false,
        fallback_to_mock: false
      };
    } else if (path === "/api/v1/projects/context-alpha") {
      body = {
        project,
        chat_id: "context-alpha-chat",
        messages: [
          {
            id: "context-message",
            project_id: project.id,
            chat_id: "context-alpha-chat",
            role: "user",
            content_type: "text",
            content: "Подготовь безопасный контекст проекта",
            status: "completed",
            reply_to_message_id: null,
            run_id: null,
            error_code: null,
            created_at: project.created_at,
            updated_at: project.updated_at
          }
        ]
      };
    } else if (path.endsWith("/autonomy-profile")) {
      body = { profile: { base_level: "A0", version: 1 } };
    } else {
      body = { items: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
});

test("previews, connects, persists and explicitly clears project context", async ({ page }) => {
  await page.goto("/?project=context-alpha&view=context");

  await expect(page.getByRole("tab", { name: "Контекст" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await expect(page.getByRole("tabpanel", { name: "Контекст проекта" })).toBeVisible();
  await expect(page.getByText("Подключено 2 из 3")).toBeVisible();
  await expect(page.getByText(/13 800 \/ 64 000 токенов/)).toBeVisible();

  await page.getByRole("button", { name: "Подключить" }).click();
  const preview = page.getByRole("dialog", { name: "Project handoff" });
  await expect(preview).toContainText("Предпросмотр перед добавлением");
  await expect(preview).toContainText("12 400 токенов");
  await preview.getByRole("button", { name: "Подключить источник" }).click();
  await expect(page.getByText("Подключено 3 из 3")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Подключено 3 из 3")).toBeVisible();

  await page.getByRole("button", { name: "Очистить контекст" }).click();
  const clearDialog = page.getByRole("dialog", { name: "Очистить контекст проекта?" });
  await expect(clearDialog).toContainText("История чата, проект и документы не удаляются");
  await clearDialog.getByRole("button", { name: "Очистить контекст" }).click();
  await expect(page.getByText("Подключено 0 из 3")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Подключено 0 из 3")).toBeVisible();
});

test("redacts secret-like values from corrupted or user-controlled local context", async ({ page }) => {
  await page.goto("/?project=context-alpha&view=context");
  await page.evaluate(() => {
    window.localStorage.setItem(
      "cosmora:project-context:context-alpha",
      JSON.stringify({
        sources: [
          {
            id: "secret-fixture",
            title: "api_key=super-secret-value",
            kind: "document",
            summary: "Bearer abcdefghijklmnop and token=very-secret-token",
            size: 100,
            connected: true
          }
        ]
      })
    );
  });
  await page.reload();

  const panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  await expect(panel).toContainText("[скрыто]");
  await expect(panel).not.toContainText("super-secret-value");
  await expect(panel).not.toContainText("abcdefghijklmnop");
  await expect(panel).not.toContainText("very-secret-token");
});

test("shows offline state without losing local context", async ({ page, context }) => {
  await page.goto("/?project=context-alpha&view=context");
  await page.getByRole("button", { name: "Отключить" }).first().click();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));

  await expect(page.getByText(/Offline · изменения сохраняются локально/)).toBeVisible();
  await expect(page.getByText("Подключено 1 из 3")).toBeVisible();

  await context.setOffline(false);
});
