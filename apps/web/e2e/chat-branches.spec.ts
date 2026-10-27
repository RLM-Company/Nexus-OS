import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
  ChatBranchList,
  GeneralChatDetailResponse,
  GeneralChatMessageAcceptedResponse
} from "@cosmora/contracts";

const api = "http://127.0.0.1:3100";
async function source(page: Page, request: APIRequestContext, twoTurns = true) {
  const created = await request.post(`${api}/api/v1/chats`, {
    data: { initial_message: "Исходный запрос", client_message_id: randomUUID() }
  });
  const first = (await created.json()) as GeneralChatMessageAcceptedResponse;
  expect(created.status()).toBe(201);
  await request.get(`${api}${first.stream_url}`);
  if (twoTurns) {
    const second = await request.post(`${api}/api/v1/chats/${first.chat.id}/messages`, {
      data: { content: "Поздний секрет первоначального чата", client_message_id: randomUUID() }
    });
    await request.get(
      `${api}${((await second.json()) as GeneralChatMessageAcceptedResponse).stream_url}`
    );
  }
  const snapshot = (await (
    await request.get(`${api}/api/v1/chats/${first.chat.id}`)
  ).json()) as GeneralChatDetailResponse;
  await page.goto(`/?chat=${first.chat.id}`);
  await expect(page.locator(".topbar h1")).toHaveText("Исходный запрос");
  await expect(
    page.getByRole("button", { name: "Изменить запрос", exact: true }).first()
  ).toBeEnabled();
  return { id: first.chat.id, snapshot };
}
async function branch(page: Page, original: string) {
  await expect(page).toHaveURL(
    (url) => Boolean(url.searchParams.get("chat")) && url.searchParams.get("chat") !== original
  );
  const id = new URL(page.url()).searchParams.get("chat")!;
  await expect(
    page.getByRole("region", { name: "Обычный чат Kosmora", exact: true }).getByRole("status")
  ).toHaveText("Ответ получен");
  await expect(
    page.getByRole("combobox", { name: "Варианты переписки", exact: true })
  ).toBeVisible();
  return id;
}

test("edit preserves the original and composer draft; variants switch and survive reload", async ({
  page,
  request
}) => {
  const original = await source(page, request);
  const composer = page.getByRole("textbox", { name: "Сообщение Kosmora", exact: true });
  await composer.fill("Мой неотправленный черновик");
  await page.getByRole("button", { name: "Изменить запрос", exact: true }).first().click();
  let dialog = page.getByRole("dialog", { name: "Изменить запрос", exact: true });
  await dialog
    .getByRole("textbox", { name: "Новый текст запроса", exact: true })
    .fill("Отменённая правка");
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(composer).toHaveValue("Мой неотправленный черновик");
  await page.getByRole("button", { name: "Изменить запрос", exact: true }).first().click();
  dialog = page.getByRole("dialog", { name: "Изменить запрос", exact: true });
  await dialog
    .getByRole("textbox", { name: "Новый текст запроса", exact: true })
    .fill("Новый независимый запрос");
  await dialog
    .getByRole("button", { name: "Создать вариант и получить ответ", exact: true })
    .click();
  const id = await branch(page, original.id);
  const detail = (await (
    await request.get(`${api}/api/v1/chats/${id}`)
  ).json()) as GeneralChatDetailResponse;
  expect(
    detail.messages.filter((message) => message.role === "user").map((message) => message.content)
  ).toEqual(["Новый независимый запрос"]);
  await page.reload();
  const selector = page.getByRole("combobox", { name: "Варианты переписки", exact: true });
  await expect(selector).toHaveValue(id);
  await selector.selectOption(original.id);
  await expect(page).toHaveURL(new RegExp(`chat=${original.id}`));
  await expect(composer).toHaveValue("Мой неотправленный черновик");
  expect(await (await request.get(`${api}/api/v1/chats/${original.id}`)).json()).toEqual(
    original.snapshot
  );
});

test("regenerates an answer with its preceding context and replays the saved result after reload", async ({
  page,
  request
}) => {
  const original = await source(page, request);
  await page.getByRole("button", { name: "Повторить ответ", exact: true }).last().click();
  const dialog = page.getByRole("dialog", { name: "Повторить ответ", exact: true });
  await expect(dialog).toContainText("Исходная переписка сохранится");
  await dialog
    .getByRole("button", { name: "Создать вариант и получить ответ", exact: true })
    .click();
  const id = await branch(page, original.id);
  const detail = (await (
    await request.get(`${api}/api/v1/chats/${id}`)
  ).json()) as GeneralChatDetailResponse;
  expect(detail.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
    "user",
    "assistant"
  ]);
  expect(detail.messages.slice(0, 3).map((message) => message.content)).toEqual(
    original.snapshot.messages.slice(0, 3).map((message) => message.content)
  );
  expect(detail.messages.at(-1)?.id).not.toBe(original.snapshot.messages.at(-1)?.id);
  await page.reload();
  await expect(
    page.getByRole("region", { name: "Обычный чат Kosmora", exact: true }).getByRole("status")
  ).toHaveText("Ответ получен");
  expect(await (await request.get(`${api}/api/v1/chats/${id}`)).json()).toEqual(detail);
});

test("recovers a lost creation response by known branch ID and never posts a second generation", async ({
  page,
  request
}) => {
  const original = await source(page, request, false);
  let writes = 0;
  await page.route(`**/api/v1/chats/${original.id}/branches`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Повторить ответ", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Повторить ответ", exact: true })
    .getByRole("button", { name: "Создать вариант и получить ответ", exact: true })
    .click();
  const id = await branch(page, original.id);
  expect(writes).toBe(1);
  const family = (await (
    await request.get(`${api}/api/v1/chats/${id}/branches`)
  ).json()) as ChatBranchList;
  expect(family.items).toHaveLength(2);
  const detail = (await (
    await request.get(`${api}/api/v1/chats/${id}`)
  ).json()) as GeneralChatDetailResponse;
  expect(detail.messages).toHaveLength(2);
});
