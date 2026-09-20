import { expect, test } from "@playwright/test";

test("creates a mini-AI locally and sends its snapshot only with a new chat", async ({ page }) => {
  await page.route("**/api/v1/settings/token-economy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: false })
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Редактор" }).click();
  await page.getByRole("button", { name: "Сохранить мини‑ИИ" }).click();
  await expect(page.getByText("Редактор", { exact: true }).last()).toBeVisible();

  await page.goto("/");
  const profile = page.getByLabel("Мини‑ИИ для нового чата");
  await expect(profile).toHaveValue("");
  await profile.selectOption({ label: "Редактор" });

  let sentProfile: unknown = null;
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    sentProfile = (route.request().postDataJSON() as { assistant_profile?: unknown })
      .assistant_profile;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        chat: {
          id: "custom-profile-chat",
          title: "Проверь мой текст",
          assistant_profile_name: "Редактор",
          created_at: "2026-09-20T12:00:00.000Z",
          updated_at: "2026-09-20T12:00:00.000Z"
        },
        user_message: {
          id: "custom-profile-message",
          chat_id: "custom-profile-chat",
          role: "user",
          content_type: "text",
          content: "Проверь мой текст",
          status: "completed",
          run_id: "custom-profile-run",
          error_code: null,
          created_at: "2026-09-20T12:00:00.000Z",
          updated_at: "2026-09-20T12:00:00.000Z"
        },
        run_id: "custom-profile-run",
        stream_url: "/api/v1/chat-runs/custom-profile-run/events"
      })
    });
  });
  await page.getByLabel("Сообщение Cosmora").fill("Проверь мой текст");
  await page.getByRole("button", { name: "Отправить" }).click();

  await expect
    .poll(() => sentProfile)
    .toEqual({
      name: "Редактор",
      instructions:
        "Работай как внимательный редактор. Сохраняй смысл автора, предлагай ясные формулировки и кратко объясняй существенные правки."
    });
  await expect(page.getByText("Редактор", { exact: true }).last()).toBeVisible();
});
