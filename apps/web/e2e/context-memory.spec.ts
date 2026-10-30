import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const api = "http://127.0.0.1:3100";
test.use({ timezoneId: "Europe/Moscow" });
async function chat(request: APIRequestContext, content: string) {
  const response = await request.post(api + "/api/v1/chats", {
    data: { initial_message: content, client_message_id: randomUUID() }
  });
  expect(response.status()).toBe(201);
  const value = (await response.json()) as {
    chat: { id: string; title: string };
    stream_url: string;
  };
  await request.get(api + value.stream_url);
  return value.chat;
}
async function open(page: Page, id: string, title: string) {
  await page.goto("/?chat=" + id);
  await expect(page.locator(".topbar h1")).toHaveText(title);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const memory = page.getByRole("group", { name: "Общая память и источники", exact: true });
  await expect(memory.getByLabel("Использовать общую память", { exact: true })).toBeEnabled();
  return memory;
}

test("selects cross-chat sources, saves profile facts, previews and reads original evidence", async ({
  page,
  request
}) => {
  const source = await chat(
    request,
    "Джалиль: согласован бюджет 17350.25 ₽ на 2026-11-02. " + randomUUID()
  );
  const target = await chat(request, "Новая задача памяти " + randomUUID());
  const memory = await open(page, target.id, target.title);
  await memory.getByLabel("Использовать общую память", { exact: true }).check();
  await memory.getByLabel("Использовать мой общий профиль", { exact: true }).check();
  await memory.getByText("Чаты и проекты для поиска", { exact: true }).click();
  await memory.getByLabel(source.title, { exact: true }).check();
  await memory.getByRole("button", { name: "Сохранить доступ к памяти", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Доступ к памяти сохранён.");
  await memory.getByText("Записи памяти", { exact: true }).click();
  await memory
    .getByRole("combobox", { name: "Область записи", exact: true })
    .selectOption("personal");
  await memory
    .getByRole("combobox", { name: "Тип записи", exact: true })
    .selectOption("constraint");
  const title = "Правило памяти " + randomUUID();
  await memory.getByRole("textbox", { name: "Название воспоминания", exact: true }).fill(title);
  await memory
    .getByRole("textbox", { name: "Содержание воспоминания", exact: true })
    .fill("Не менять sidebar без моего запроса.");
  const expiry = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 7);
    date.setHours(23, 59, 59, 999);
    return {
      day: [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-"),
      iso: date.toISOString()
    };
  });
  await memory.getByLabel("Актуально до (необязательно)", { exact: true }).fill(expiry.day);
  await memory.getByRole("button", { name: "Добавить воспоминание", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Запись сохранена.");
  const saved = await request.get(api + "/api/v1/memory?q=" + encodeURIComponent(title));
  expect((await saved.json()).items[0].expires_at).toBe(expiry.iso);
  await memory.getByText("Проверить, что вспомнит ИИ", { exact: true }).click();
  await memory
    .getByRole("textbox", { name: "Запрос для проверки памяти", exact: true })
    .fill("Джалиль бюджет");
  await memory.getByRole("button", { name: "Проверить подбор контекста", exact: true }).click();
  const preview = memory.getByRole("region", { name: "Подобранный контекст", exact: true });
  await expect(preview).toContainText("17350.25");
  await expect(preview).toContainText("Не менять sidebar");
  await page.screenshot({ path: test.info().outputPath("context-memory-settings.png") });
  await preview
    .getByRole("button", { name: "Открыть исходное сообщение", exact: true })
    .first()
    .click();
  await expect(memory.getByRole("region", { name: "Исходное сообщение" })).toContainText(
    "17350.25"
  );
  await page.reload();
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await expect(memory.getByLabel("Использовать общую память", { exact: true })).toBeChecked();
  await memory.getByText("Записи памяти", { exact: true }).click();
  await memory.getByRole("button", { name: "Забыть «" + title + "»", exact: true }).click();
  await expect(memory.getByRole("status")).toContainText("Запись и её версии удалены");
  expect((await request.get(api + "/api/v1/chats/" + source.id)).ok()).toBe(true);
});

test("retains the draft on concurrent record edits and rejects stale settings without overwriting", async ({
  page,
  request
}) => {
  const target = await chat(request, "Конфликт памяти " + randomUUID());
  const created = await request.post(api + "/api/v1/memory", {
    data: {
      scope: "chat",
      scope_id: target.id,
      kind: "fact",
      title: "Конкурентная запись",
      content: "Первая версия.",
      pinned: false,
      expires_at: null,
      source: null
    }
  });
  expect(created.status()).toBe(201);
  const entry = (await created.json()) as { id: string };
  const memory = await open(page, target.id, target.title);
  await memory.getByText("Записи памяти", { exact: true }).click();
  await memory.getByRole("button", { name: "Изменить «Конкурентная запись»", exact: true }).click();
  await memory
    .getByRole("textbox", { name: "Содержание воспоминания", exact: true })
    .fill("Мой несохранённый текст.");
  const external = await request.put(api + "/api/v1/memory/" + entry.id, {
    data: {
      scope: "chat",
      scope_id: target.id,
      kind: "fact",
      title: "Конкурентная запись",
      content: "Правка другой вкладки.",
      pinned: false,
      expires_at: null,
      source: null,
      expected_version: 1
    }
  });
  expect(external.ok()).toBe(true);
  await memory.getByRole("button", { name: "Сохранить воспоминание", exact: true }).click();
  await expect(memory.getByRole("alert")).toContainText("Запись изменилась");
  await expect(
    memory.getByRole("textbox", { name: "Содержание воспоминания", exact: true })
  ).toHaveValue("Мой несохранённый текст.");
  const settings = api + "/api/v1/memory/targets/chat/" + target.id + "/settings";
  expect(
    (
      await request.put(settings, {
        data: {
          enabled: true,
          use_personal: false,
          source_chat_ids: [],
          project_ids: [],
          expected_version: 0
        }
      })
    ).ok()
  ).toBe(true);
  await memory.getByRole("button", { name: "Сохранить доступ к памяти", exact: true }).click();
  await expect(memory.getByRole("alert")).toContainText("Настройки изменились");
  expect((await (await request.get(settings)).json()).enabled).toBe(true);
});

test("explains a mandatory-memory overflow without calling it an oversized user message", async ({
  page,
  request
}) => {
  const target = await chat(request, "Проверка обязательной памяти " + randomUUID());
  for (let i = 0; i < 50; i++) {
    const saved = await request.post(api + "/api/v1/memory", {
      data: {
        scope: "chat",
        scope_id: target.id,
        kind: "constraint",
        title: "Rule " + i,
        content: "Mandatory rule " + i + ".",
        pinned: true,
        expires_at: null,
        source: null
      }
    });
    expect(saved.status()).toBe(201);
  }
  expect(
    (
      await request.put(api + "/api/v1/memory/targets/chat/" + target.id + "/settings", {
        data: {
          enabled: true,
          use_personal: false,
          source_chat_ids: [],
          project_ids: [],
          expected_version: 0
        }
      })
    ).ok()
  ).toBe(true);
  const accepted = await request.post(api + "/api/v1/chats/" + target.id + "/messages", {
    data: { content: "Продолжай", client_message_id: randomUUID() }
  });
  const value = (await accepted.json()) as { stream_url: string };
  expect((await request.get(api + value.stream_url)).status()).toBe(200);
  await page.goto("/?chat=" + target.id);
  await expect(
    page.getByText("Обязательные записи памяти не поместились.", { exact: false })
  ).toBeVisible();
  await expect(
    page.getByText("Сообщение и материалы слишком большие.", { exact: false })
  ).toHaveCount(0);
});
