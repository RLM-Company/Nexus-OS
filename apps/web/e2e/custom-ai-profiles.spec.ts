import { expect, test } from "@playwright/test";

test("persists a mini-AI on the server and sends its snapshot only with a new chat", async ({
  page
}) => {
  await page.route("**/api/v1/settings/token-economy", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ enabled: false })
    });
  });

  await page.goto("/settings");
  await page.getByRole("button", { name: "Редактор" }).click();
  await page.getByLabel("Тон").selectOption("direct");
  await page.getByLabel("Подробность").selectOption("short");
  await page.getByLabel("Формат").selectOption("steps");
  await page.getByRole("button", { name: "Применить к инструкции" }).click();
  await expect(page.getByLabel("Инструкции для стиля ответа")).toHaveValue(
    /Прямой тон без лишних вступлений/
  );
  await expect(page.getByLabel("Инструкции для стиля ответа")).toHaveValue(/Короткие ответы/);
  await expect(page.getByLabel("Инструкции для стиля ответа")).toHaveValue(/Пошаговая структура/);
  await page.getByLabel("Значок").fill("📝");
  await page.getByLabel("Запрос 1").fill("Отредактируй важное письмо");
  await page.getByRole("button", { name: "Сохранить мини‑ИИ" }).click();
  await expect(page.getByText("📝 Редактор", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Изменить" }).click();
  await page
    .getByLabel("Инструкции для стиля ответа")
    .fill("Редактируй лаконично, сохраняй смысл и перечисляй важные изменения.");
  await page.getByRole("button", { name: "Сохранить изменения" }).click();
  await expect(page.getByText(/Редактируй лаконично/)).toBeVisible();

  await page.evaluate(() => window.localStorage.removeItem("cosmora:custom-ai-profiles"));
  await page.reload();
  await expect(page.getByText(/Редактируй лаконично/)).toBeVisible();

  await page.goto("/");
  const profile = page.getByLabel("Мини‑ИИ для нового чата");
  await expect(profile).toHaveValue("");
  await profile.selectOption({ label: "📝 Редактор" });
  await expect(page.getByRole("heading", { name: "📝 Редактор готов помочь" })).toBeVisible();

  let sentProfile: unknown = null;
  let createdChats = 0;
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    createdChats += 1;
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
  await page.getByRole("button", { name: "Отредактируй важное письмо" }).click();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Отредактируй важное письмо");
  await expect.poll(() => createdChats).toBe(0);
  await page.getByLabel("Сообщение Cosmora").fill("Проверь мой текст");
  await page.getByRole("button", { name: "Отправить" }).click();

  await expect
    .poll(() => sentProfile)
    .toEqual({
      name: "Редактор",
      instructions: "Редактируй лаконично, сохраняй смысл и перечисляй важные изменения."
    });
  expect(createdChats).toBe(1);
  await expect(page.getByText("Редактор", { exact: true }).last()).toBeVisible();
});
