import { expect, test } from "@playwright/test";

test("keeps every media prompt local until a model is connected", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      writes.push(request.url());
    }
  });

  await page.goto("/");
  const sidebar = page.locator(".sidebar-tools");
  await sidebar.getByRole("button", { name: /Kosmora Studio/ }).click();
  const media = [
    ["Изображения", "изображения"],
    ["Видео", "видео"],
    ["Sound", "аудио"]
  ] as const;

  for (const [surface, label] of media) {
    await sidebar.getByRole("button", { name: surface, exact: true }).click();
    await page.getByLabel(`Промпт для ${label}`).fill(`Безопасный локальный prompt: ${label}`);
    await page.getByRole("button", { name: "Подготовить промпт" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "подготовлен локально" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Скачать .txt", exact: true })).toBeEnabled();
    if (surface === "Изображения") {
      await expect(
        page.getByRole("button", { name: "Сгенерировать изображение", exact: true })
      ).toBeDisabled();
    }
  }

  expect(writes).toEqual([]);
});
