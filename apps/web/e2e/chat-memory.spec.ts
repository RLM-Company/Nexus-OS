import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const api = "http://127.0.0.1:3100";
async function chat(page: Page, request: APIRequestContext) {
  const response = await request.post(`${api}/api/v1/chats`, {
    data: { initial_message: "Проверка памяти", client_message_id: randomUUID() }
  });
  expect(response.status()).toBe(201);
  const accepted = (await response.json()) as { chat: { id: string }; stream_url: string };
  await request.get(`${api}${accepted.stream_url}`);
  await page.goto(`/?chat=${accepted.chat.id}`);
  await expect(page.locator(".topbar h1")).toHaveText("Проверка памяти");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const memory = page.getByRole("group", { name: "Память чата", exact: true });
  const input = memory.getByLabel("Заметки для следующих ответов", { exact: true });
  await expect(input).toBeEnabled();
  return { id: accepted.chat.id, memory, input, path: `/api/v1/chats/${accepted.chat.id}/memory` };
}

test("saves and clears notes through the real API and persists them after reload", async ({
  page,
  request
}) => {
  const { id, memory, input, path } = await chat(page, request);
  const notes = "Проект: TypeScript, чёрно-белый интерфейс.";
  await input.fill(notes);
  await memory.getByRole("button", { name: "Сохранить память", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Память сохранена.");
  expect((await (await request.get(`${api}${path}`)).json()).memory).toMatchObject({
    memory_notes: notes,
    version: 1
  });
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Проверка памяти");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await expect(input).toHaveValue(notes);
  await page.screenshot({ path: test.info().outputPath("chat-memory.png") });
  await memory.getByRole("button", { name: "Очистить память", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Память очищена.");
  await expect(input).toHaveValue("");
  expect((await (await request.get(`${api}${path}`)).json()).memory.version).toBe(2);
  const detail = (await (await request.get(`${api}/api/v1/chats/${id}`)).json()) as {
    messages: unknown[];
  };
  expect(detail.messages).toHaveLength(2);
});

test("keeps an unsaved draft after a concurrent edit and lets the user load the current version", async ({
  page,
  request
}) => {
  const { memory, input, path } = await chat(page, request);
  await input.fill("Локальная правка");
  const external = await request.put(`${api}${path}`, {
    data: { memory_notes: "Сохранено другой вкладкой", expected_version: 0 }
  });
  expect(external.ok()).toBe(true);
  await memory.getByRole("button", { name: "Сохранить память", exact: true }).click();
  await expect(memory.getByRole("alert")).toContainText("другой вкладке");
  await expect(input).toHaveValue("Локальная правка");
  expect((await (await request.get(`${api}${path}`)).json()).memory.memory_notes).toBe(
    "Сохранено другой вкладкой"
  );
  await memory.getByRole("button", { name: "Загрузить сохранённую версию", exact: true }).click();
  await expect(input).toHaveValue("Сохранено другой вкладкой");
});

test("reconciles a lost PUT response without sending a second write", async ({ page, request }) => {
  const { memory, input, path } = await chat(page, request);
  let writes = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    await route.fetch();
    await route.abort("failed");
  });
  await input.fill("Сохранено несмотря на обрыв соединения");
  await memory.getByRole("button", { name: "Сохранить память", exact: true }).click();
  await expect(memory.getByRole("status")).toHaveText("Память сохранена.");
  expect(writes).toBe(1);
  expect((await (await request.get(`${api}${path}`)).json()).memory.version).toBe(1);
});
