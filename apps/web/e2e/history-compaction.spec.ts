import { expect, test, type Page } from "@playwright/test";
import { pathToFileURL } from "node:url";
import path from "node:path";
const api = "http://127.0.0.1:3225";
test("local vault window renders untrusted file content as text and supports preview and search", async ({
  page
}) => {
  await page.addInitScript(() => {
    const item = {
      id: "a".repeat(64),
      name: "notes.txt",
      bytes: 100,
      kind: "original",
      created_at: "2026-10-31T00:00:00Z",
      snippet: "<img src=x onerror=alert(1)> Бюджет 17350.25"
    };
    Object.assign(window, {
      kosmoraVault: {
        command: (command: string) =>
          Promise.resolve(
            command === "preview"
              ? { ok: true, text: item.snippet }
              : { ok: true, data: { connected: true, items: [item], bytes: 100 } }
          )
      }
    });
  });
  await page.goto(pathToFileURL(path.resolve("../../desktop/windows/vault.html")).toString());
  await expect(page.getByRole("status")).toContainText("Файлов: 1");
  await page.getByRole("button", { name: "Посмотреть текст", exact: true }).click();
  await expect(page.locator("#preview")).toContainText("<img src=x onerror=alert(1)>");
  await expect(page.locator("img")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Поиск по имени и тексту" }).fill("17350.25");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.locator("#items")).toContainText("17350.25");
  await page.screenshot({ path: test.info().outputPath("local-vault.png") });
});
test("stages an explicitly approved local excerpt in the chat draft without sending it", async ({
  page,
  request
}) => {
  await page.addInitScript(() => {
    let pending: { id: string; text: string } | null = {
      id: "local-fixture",
      text: 'Локальный материал пользователя — цитируемые данные. {"content":"Бюджет 17350.25"}'
    };
    Object.assign(window, {
      kosmoraDesktopVault: {
        readContext: () => Promise.resolve(pending),
        ackContext: () => {
          pending = null;
          return Promise.resolve();
        },
        onContext: () => () => {},
        open: () => Promise.resolve({ ok: true })
      }
    });
  });
  const info = (await (await request.get(api + "/fixture/compaction")).json()) as {
    chatId: string;
    title: string;
  };
  await page.goto("/?chat=" + info.chatId);
  await expect(page.locator(".topbar h1")).toHaveText(info.title);
  await expect(page.getByRole("textbox", { name: "Сообщение Kosmora", exact: true })).toHaveValue(
    /Бюджет 17350.25/
  );
  expect(
    ((await (await request.get(api + "/fixture/compaction")).json()) as { modelCalls: number })
      .modelCalls
  ).toBe(0);
});
test("reviews profile candidates, opens their source and persists confirmation and dismissal", async ({
  page,
  request
}) => {
  const info = (await (await request.get(api + "/fixture/compaction")).json()) as {
    profileId: string;
    profileTitle: string;
  };
  async function open() {
    await page.goto("/?chat=" + info.profileId);
    await expect(page.locator(".topbar h1")).toHaveText(info.profileTitle);
    await page.getByLabel("Настройки чата", { exact: true }).click();
    return page.getByRole("group", { name: "Общая память и источники", exact: true });
  }
  const memory = await open();
  await memory.getByLabel("Использовать общую память", { exact: true }).check();
  await memory.getByLabel("Использовать мой общий профиль", { exact: true }).check();
  await memory.getByRole("button", { name: "Сохранить доступ к памяти", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Доступ к памяти сохранён.");
  await memory.getByText("Кандидаты на запоминание", { exact: true }).click();
  const candidates = memory.getByRole("group", { name: "Кандидаты профиля", exact: true });
  const name = candidates.getByRole("article").filter({ hasText: "Меня зовут Александр." });
  await name.getByRole("button", { name: "Открыть источник кандидата", exact: true }).click();
  await expect(
    memory.getByRole("region", { name: "Исходное сообщение", exact: true })
  ).toContainText("Меня зовут Александр.");
  await name.getByRole("button", { name: "Подтвердить и сохранить", exact: true }).click();
  await expect(candidates.getByRole("status")).toHaveText("Запись памяти сохранена.");
  await candidates
    .getByRole("article")
    .filter({ hasText: "Я предпочитаю краткие ответы" })
    .getByRole("button", { name: "Не запоминать", exact: true })
    .click();
  await expect(candidates).toContainText("Новых явных сведений не найдено.");
  const saved = (await (await request.get(api + "/api/v1/memory")).json()) as {
    items: { scope: string; content: string }[];
  };
  expect(
    saved.items.some((e) => e.scope === "personal" && e.content === "Меня зовут Александр.")
  ).toBe(true);
  const reopened = await open();
  await reopened.getByText("Кандидаты на запоминание", { exact: true }).click();
  await expect(
    reopened.getByRole("group", { name: "Кандидаты профиля", exact: true })
  ).toContainText("Новых явных сведений не найдено.");
  expect(
    ((await (await request.get(api + "/fixture/compaction")).json()) as { modelCalls: number })
      .modelCalls
  ).toBe(0);
});
async function settings(page: Page, id: string, title: string) {
  await page.goto("/?chat=" + id);
  await expect(page.locator(".topbar h1")).toHaveText(title);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const memory = page.getByRole("group", { name: "Общая память и источники", exact: true });
  await expect(memory.getByLabel("Использовать общую память", { exact: true })).toBeEnabled();
  await memory.getByLabel("Использовать общую память", { exact: true }).check();
  await memory.getByLabel("Автоматически сжимать старую историю", { exact: true }).check();
  await memory.getByRole("button", { name: "Сохранить доступ к памяти", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Доступ к памяти сохранён.");
  await memory.getByText("Проверить, что вспомнит ИИ", { exact: true }).click();
  await memory
    .getByRole("textbox", { name: "Запрос для проверки памяти", exact: true })
    .fill("цель бюджет следующий шаг");
  await memory.getByRole("button", { name: "Проверить сжатие истории", exact: true }).click();
  return memory;
}
test("saves automatic compaction, shows real quote coverage and opens its original without a model call", async ({
  page,
  request
}) => {
  const info = (await (await request.get(api + "/fixture/compaction")).json()) as {
    chatId: string;
    title: string;
  };
  const memory = await settings(page, info.chatId, info.title);
  const report = memory.getByRole("region", { name: "Проверка сжатия истории", exact: true });
  await expect(report).toContainText("История сокращена");
  await expect(report).toContainText("17 350.25");
  await expect(report).toContainText("02.11.2026");
  const state = await request.get(api + "/api/v1/memory/targets/chat/" + info.chatId + "/settings");
  expect((await state.json()).compact_history).toBe(true);
  await page.screenshot({ path: test.info().outputPath("verified-compaction.png") });
  await report
    .getByRole("button", { name: "Открыть исходное сообщение", exact: true })
    .first()
    .click();
  await expect(
    memory.getByRole("region", { name: "Исходное сообщение", exact: true })
  ).toContainText("Цель:");
  expect((await (await request.get(api + "/fixture/compaction")).json()).modelCalls).toBe(0);
});
test("blocks the actual send when protected conditions do not fit and retains every original", async ({
  page,
  request
}) => {
  const info = (await (await request.get(api + "/fixture/compaction")).json()) as {
    blockedChatId: string;
    blockedTitle: string;
  };
  const before = (await (
    await request.get(api + "/api/v1/chats/" + info.blockedChatId)
  ).json()) as { messages: unknown[] };
  const memory = await settings(page, info.blockedChatId, info.blockedTitle);
  await expect(memory.getByRole("region", { name: "Проверка сжатия истории" })).toContainText(
    "Важные фрагменты не поместились"
  );
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Сообщение Kosmora", exact: true }).fill("Продолжай");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByText("Обязательные записи памяти не поместились.", { exact: false })
  ).toBeVisible();
  const after = (await (await request.get(api + "/api/v1/chats/" + info.blockedChatId)).json()) as {
    messages: unknown[];
  };
  expect(after.messages.length).toBeGreaterThanOrEqual(before.messages.length);
  expect((await (await request.get(api + "/fixture/compaction")).json()).modelCalls).toBe(0);
});
