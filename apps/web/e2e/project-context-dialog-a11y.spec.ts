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
    const path = new URL(route.request().url()).pathname;
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
        messages: []
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

test("manages focus and Escape for Project Context dialogs", async ({ page }) => {
  await page.goto("/?project=context-alpha&view=context");

  const panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  const connectButton = panel.getByRole("button", { name: "Подключить" });

  await connectButton.click();
  const preview = page.getByRole("dialog", { name: "Project handoff" });
  const previewCancel = preview.getByRole("button", { name: "Отмена" });
  await expect(previewCancel).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(connectButton).toBeFocused();

  const clearButton = panel.getByRole("button", { name: "Очистить контекст" });
  await clearButton.click();
  const clearDialog = page.getByRole("dialog", { name: "Очистить контекст проекта?" });
  await expect(clearDialog.getByRole("button", { name: "Отмена" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(clearDialog).toHaveCount(0);
  await expect(clearButton).toBeFocused();

  await clearButton.click();
  await page
    .getByRole("dialog", { name: "Очистить контекст проекта?" })
    .getByRole("button", { name: "Очистить контекст" })
    .click();

  await expect(panel.getByRole("heading", { name: "Подключено 0 из 3" })).toBeFocused();
});
