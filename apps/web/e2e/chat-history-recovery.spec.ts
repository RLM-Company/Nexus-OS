import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function createChat(request: APIRequestContext, title: string) {
  const response = await request.post("http://127.0.0.1:3100/api/v1/chats", {
    data: { initial_message: title, client_message_id: crypto.randomUUID() }
  });
  expect(response.status()).toBe(201);
  const accepted = (await response.json()) as { chat: { id: string }; run_id: string };
  await request.post(`http://127.0.0.1:3100/api/v1/chat-runs/${accepted.run_id}/cancel`);
  return accepted.chat.id;
}

async function openChat(page: Page, title: string) {
  await page
    .locator(".sidebar .chat-item")
    .filter({ has: page.locator("strong", { hasText: title }) })
    .click();
  await expect(page.getByLabel("Сообщение Cosmora")).toBeEnabled();
}

test("a late archive response cannot navigate away from another chat or clear its attachments", async ({
  page,
  request
}) => {
  const firstTitle = `Archive source ${crypto.randomUUID().slice(0, 8)}`;
  const secondTitle = `Archive target ${crypto.randomUUID().slice(0, 8)}`;
  const first = await createChat(request, firstTitle);
  await createChat(request, secondTitle);
  let release: (() => Promise<void>) | undefined;
  await page.route(`**/api/v1/chats/${first}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    release = async () => {
      await route.fulfill({ response }).catch(() => undefined);
    };
  });
  await page.goto("/");
  await openChat(page, firstTitle);
  await page.getByText("Управление чатом", { exact: true }).click();
  await page.getByRole("button", { name: "Убрать чат в архив", exact: true }).click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await openChat(page, secondTitle);
  await page.getByLabel("Сообщение Cosmora").fill("Unsent draft in the second chat");
  await page
    .getByLabel("Текстовые файлы и код")
    .setInputFiles({
      name: "second.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Second chat only")
    });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("second.txt");
  await release!();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  await expect(page.locator(".sidebar .chat-item.active")).toContainText(secondTitle);
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Unsent draft in the second chat");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("second.txt");
});

test("a stalled chat rename releases its controls without retrying automatically", async ({
  page,
  request
}) => {
  const title = `Rename deadline ${crypto.randomUUID().slice(0, 8)}`;
  const id = await createChat(request, title);
  let writes = 0;
  await page.route(`**/api/v1/chats/${id}`, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes++;
  });
  await page.goto("/");
  await openChat(page, title);
  await page.getByText("Управление чатом", { exact: true }).click();
  await page.getByLabel("Название чата").fill("My unsaved title");
  await page.getByRole("button", { name: "Сохранить название", exact: true }).click();
  await expect(page.locator(".chat-history-actions").getByRole("alert")).toContainText(
    "Не удалось подтвердить",
    { timeout: 9_000 }
  );
  await expect(page.getByLabel("Название чата")).toHaveValue("My unsaved title");
  await expect(page.getByRole("button", { name: "Сохранить название", exact: true })).toBeEnabled();
  expect(writes).toBe(1);
  await page.unroute(`**/api/v1/chats/${id}`);
  await page.getByRole("button", { name: "Сохранить название", exact: true }).click();
  await expect(page.locator(".sidebar .chat-item.active")).toContainText("My unsaved title");
});

test("a mismatched archive response cannot remove the active chat", async ({ page, request }) => {
  const title = `Archive response ${crypto.randomUUID().slice(0, 8)}`;
  const id = await createChat(request, title);
  await page.route(`**/api/v1/chats/${id}`, (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    return route.fulfill({ json: { chat: { id: "another-chat", title: "foreign-title" } } });
  });
  await page.goto("/");
  await openChat(page, title);
  await page.getByText("Управление чатом", { exact: true }).click();
  await page.getByRole("button", { name: "Убрать чат в архив", exact: true }).click();
  await expect(page.locator(".chat-history-actions").getByRole("alert")).toContainText(
    "Не удалось подтвердить"
  );
  await expect(page.locator(".sidebar .chat-item.active")).toContainText(title);
  await expect(page.locator(".sidebar")).not.toContainText("foreign-title");
});
