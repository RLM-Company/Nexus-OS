import { expect, test } from "@playwright/test";

test("renders safe Markdown, downloads code, renames and restores an archived chat", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Покажи тестовый Markdown");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
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
  await page.getByText("Управление чатом", { exact: true }).click();
  const title = `Мой чат ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("Название чата").fill(title);
  await page.getByRole("button", { name: "Сохранить название" }).click();
  await expect(page.locator(".sidebar strong").filter({ hasText: title })).toBeVisible();
  await page.getByRole("button", { name: "Убрать чат в архив" }).click();
  await expect(page.locator(".sidebar strong").filter({ hasText: title })).toHaveCount(0);
  await page.getByText("Архив чатов", { exact: true }).click();
  await page.getByRole("button", { name: `Восстановить ${title}`, exact: true }).click();
  await expect(page.locator(".sidebar strong").filter({ hasText: title })).toBeVisible();
});
