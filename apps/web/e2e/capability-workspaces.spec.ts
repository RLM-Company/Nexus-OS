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
  await sidebar.getByRole("button", { name: /Cosmora Studio/ }).click();
  const media = [
    ["Изображения", "изображения"],
    ["Видео", "видео"],
    ["Sound", "аудио"]
  ] as const;

  for (const [surface, label] of media) {
    await sidebar.getByRole("button", { name: surface, exact: true }).click();
    await page.getByLabel(`Промпт для ${label}`).fill(`Безопасный локальный prompt: ${label}`);
    await page.getByRole("button", { name: "Подготовить промпт" }).click();
    await expect(page.getByRole("status")).toContainText("подготовлен локально");
    await expect(page.getByText("Внешняя модель не подключена")).toBeVisible();
  }

  expect(writes).toEqual([]);
});
