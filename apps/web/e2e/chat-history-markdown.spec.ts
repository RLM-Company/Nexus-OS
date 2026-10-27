import { expect, test } from "@playwright/test";

test("renders safe Markdown, downloads code, renames and restores an archived chat", async ({
  page,
  context,
  request
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Покажи тестовый Markdown");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await expect(page.locator(".topbar").getByRole("heading", { level: 1 })).toHaveText(
    "Покажи тестовый Markdown"
  );
  const reply = page.locator(".message.assistant");
  await expect(reply.getByRole("heading", { name: "Результат" })).toBeVisible();
  await expect(reply.locator("table")).toContainText("Готов");
  await expect(reply.locator("img, script")).toHaveCount(0);
  await reply.getByRole("button", { name: "Копировать код", exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    "export const value = 42;\n"
  );
  const downloaded = page.waitForEvent("download");
  await reply.getByRole("button", { name: "Скачать код" }).click();
  expect((await downloaded).suggestedFilename()).toBe("kosmora-code.ts");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const title = `Мой чат ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("Название чата").fill(title);
  await page.getByRole("button", { name: "Сохранить название" }).click();
  await expect(page.locator(".sidebar strong").filter({ hasText: title })).toBeVisible();
  await expect(page.locator(".topbar").getByRole("heading", { level: 1 })).toHaveText(title);
  const chatId = new URL(page.url()).searchParams.get("chat")!;
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Убрать чат в архив" }).click();
  await expect(page.locator(".sidebar strong").filter({ hasText: title })).toHaveCount(0);
  await expect(page.locator(".topbar").getByRole("heading", { level: 1 })).toHaveText("Новый чат");
  // The owner removed the sidebar archive entry; restoration remains available by API.
  await expect(page.locator(".sidebar").getByText("Архив чатов", { exact: true })).toHaveCount(0);
  expect(
    (await request.patch(`/api/v1/chats/${chatId}`, { data: { archived: false } })).ok()
  ).toBeTruthy();
  await page.reload();
  await expect(page.locator(".sidebar strong").filter({ hasText: title })).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: title, exact: true }).click();
  await page.reload();
  await expect(page.locator(".topbar").getByRole("heading", { level: 1 })).toHaveText(title);
});
