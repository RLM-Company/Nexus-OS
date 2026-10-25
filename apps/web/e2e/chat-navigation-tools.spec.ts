import { expect, test, type Page } from "@playwright/test";

const chatIds = [
  "10a92d27-0001-4000-8000-000000000001",
  "10a92d27-0001-4000-8000-000000000002",
  "10a92d27-0001-4000-8000-000000000003"
];
const chats = chatIds.map((id, index) => ({
  id,
  title: ["Последняя беседа", "Беседа посередине", "Самая старая беседа"][index]!,
  created_at: `2026-10-0${3 - index}T12:00:00.000Z`,
  updated_at: `2026-10-0${3 - index}T12:00:00.000Z`,
  last_message_preview: "Сохранённая история"
}));
const contents = [
  "Первая заметка: Небула и Космос.",
  `${"Длинный ответ с материалами.\n".repeat(100)}Небула: выводы и следующие шаги.`,
  "Запрос без поискового слова.",
  "Последний ответ с другой темой."
];
const history = (chatId: string) =>
  contents.map((content, index) => ({
    id: `${chatId}-${index}`,
    chat_id: chatId,
    role: index % 2 ? "assistant" : "user",
    content_type: "text",
    content,
    attachments: [],
    status: "completed",
    run_id: null,
    error_code: null,
    created_at: `2026-10-01T12:0${index}:00.000Z`,
    updated_at: `2026-10-01T12:0${index}:00.000Z`
  }));

async function savedChats(page: Page) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url());
  });
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: { items: chats } });
    else await route.continue();
  });
  await page.route("**/api/v1/chats/*", async (route) => {
    const chat = chats.find((chat) => new URL(route.request().url()).pathname.endsWith(chat.id));
    if (chat && route.request().method() === "GET")
      await route.fulfill({ json: { chat, messages: history(chat.id) } });
    else await route.continue();
  });
  await page.goto(`/?chat=${chatIds[0]}`);
  await expect(page.locator(".message")).toHaveCount(4);
  return writes;
}

test("opening older chats and reloading never changes their activity order", async ({ page }) => {
  const writes = await savedChats(page);
  const labels = page.locator("#sidebar-chat-list .chat-item strong");
  const expected = chats.map((chat) => chat.title);
  await expect(labels).toHaveText(expected);
  for (const index of [2, 1, 0, 2]) {
    await page
      .locator("#sidebar-chat-list")
      .getByRole("button", { name: new RegExp(chats[index]!.title!) })
      .click();
    await expect(page.locator(".topbar h1")).toHaveText(chats[index]!.title!);
    await expect(page.locator(".message")).toHaveCount(4);
    await expect(labels).toHaveText(expected);
  }
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(4);
  await expect(labels).toHaveText(expected);
  expect(writes).toEqual([]);
});

test("search finds saved requests and replies and jumps without altering a draft or sending", async ({
  page
}) => {
  const writes = await savedChats(page);
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill("Мой несохранённый черновик");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Найти в переписке", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Поиск в переписке" });
  const field = search.getByLabel("Найти в этой переписке");
  await expect(field).toBeFocused();
  await field.fill("неБУЛА");
  await expect(search.getByText("Найдено сообщений: 2", { exact: true })).toBeVisible();
  await expect(search.locator("mark")).toHaveCount(2);
  await expect(search.locator("li")).toHaveCount(2);
  await page.screenshot({ path: "../../qa/kosmora-chat-search-desktop.png" });
  await field.press("ArrowDown");
  await expect(search.locator('button[data-active="true"]')).toContainText("Kosmora");
  await field.press("Enter");
  await expect(search).toBeHidden();
  const target = page.locator(`[id="chat-message-${chatIds[0]}-1"]`);
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(
    "Мой несохранённый черновик"
  );
  expect(writes).toEqual([]);
});

test("search closes with Escape, fits mobile, and resets when another chat opens", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await savedChats(page);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Найти в переписке", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Поиск в переписке" });
  await search.getByLabel("Найти в этой переписке").fill("такого-слова-нет");
  await expect(search).toContainText("Совпадений нет");
  await expect(search.getByLabel("Следующее найденное сообщение")).toBeDisabled();
  const box = await search.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.screenshot({ path: "../../qa/kosmora-chat-search-mobile.png" });
  await page.keyboard.press("Escape");
  await expect(search).toBeHidden();
  await expect(page.getByLabel("Настройки чата", { exact: true })).toBeFocused();
  await page.goto(`/?chat=${chatIds[1]}`);
  await expect(page.locator(".message")).toHaveCount(4);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Найти в переписке", exact: true }).click();
  await expect(search.getByLabel("Найти в этой переписке")).toHaveValue("");
  expect(writes).toEqual([]);
});

test("search paginates long histories, treats query as literal text and wraps navigation", async ({
  page
}) => {
  const writes = await savedChats(page);
  const messages = Array.from({ length: 25 }, (_, index) => ({
    ...history(chatIds[0]!)[0]!,
    id: `${chatIds[0]}-${index}`,
    content: `Сообщение ${index + 1}: [a.*] <img src=x onerror=alert(1)>`,
    role: index % 2 ? "assistant" : "user"
  }));
  await page.route(`**/api/v1/chats/${chatIds[0]}`, async (route) => {
    await route.fulfill({ json: { chat: chats[0], messages } });
  });
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(25);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Найти в переписке", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Поиск в переписке" });
  const field = search.getByLabel("Найти в этой переписке");
  await field.fill("[a.*]");
  await expect(search).toContainText("Найдено сообщений: 25");
  await expect(search.locator("li")).toHaveCount(20);
  await expect(search.locator("img, script")).toHaveCount(0);
  await field.press("ArrowUp");
  await expect(search).toContainText("25 / 25");
  await expect(search.locator("li")).toHaveCount(5);
  await expect(search.locator('button[data-active="true"]')).toContainText("Сообщение 25");
  await field.press("Enter");
  await expect(page.locator(`[id="chat-message-${chatIds[0]}-24"]`)).toBeFocused();
  expect(writes).toEqual([]);
});

test("request actions copy the full text and append it to the existing composer draft", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const writes = await savedChats(page);
  const request = page.locator(".message.user").first();
  await request.getByRole("button", { name: "Копировать запрос", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(contents[0]);
  const composer = page.getByLabel("Сообщение Kosmora", { exact: true });
  await composer.fill("Существующий текст");
  await request.getByRole("button", { name: "Вставить в сообщение", exact: true }).click();
  await expect(composer).toHaveValue(`Существующий текст\n\n${contents[0]}`);
  await expect(composer).toBeFocused();
  await expect(page.locator(".message")).toHaveCount(4);
  expect(writes).toEqual([]);
});
