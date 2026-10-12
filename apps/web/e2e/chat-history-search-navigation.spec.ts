import { expect, test } from "@playwright/test";

const at = "2026-10-09T10:00:00.000Z";
const project = {
  id: "search-project",
  title: "Лунный проект",
  status: "ACTIVE",
  created_at: at,
  updated_at: at
};
const projectMessage = {
  id: "search-project-message",
  project_id: project.id,
  chat_id: "search-project-chat",
  role: "user",
  content_type: "text",
  content: "Секретный проект",
  status: "completed",
  reply_to_message_id: null,
  run_id: null,
  error_code: null,
  created_at: at,
  updated_at: at
};

test("search result opens and focuses the exact project message", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path === "/api/v1/chat-history/search") {
      body = {
        items: [
          {
            scope: "project",
            chat_id: "search-project-chat",
            project_id: project.id,
            message_id: projectMessage.id,
            title: project.title,
            snippet: projectMessage.content,
            created_at: at,
            archived: false
          }
        ],
        next_offset: null
      };
    } else if (path === "/api/v1/projects") {
      body = { items: [{ ...project, last_message_preview: projectMessage.content }] };
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
    } else if (path === `/api/v1/projects/${project.id}`) {
      body = { project, chat_id: "search-project-chat", messages: [projectMessage] };
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

  await page.goto("/search?q=Секретный");
  await page.getByRole("link", { name: "Открыть проект: Лунный проект" }).click();
  await expect(page).toHaveURL(/project=search-project&view=chat&message=search-project-message/);
  await expect(page.locator("#chat-message-search-project-message")).toBeFocused();
});
