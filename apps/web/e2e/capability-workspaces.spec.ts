import { expect, test } from "@playwright/test";

test("keeps media configuration local until explicit generation is available", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
      if (!request.url().endsWith("/chat-navigation/import-pins")) writes.push(request.url());
  });
  await page.goto("/?surface=images");
  await page.getByLabel("Описание изображения", { exact: true }).fill("Лунная станция");
  await page.getByRole("button", { name: "16:9", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Сгенерировать изображение", exact: true })
  ).toBeDisabled();
  await page.goto("/?surface=video");
  await page.getByLabel("Описание сцены", { exact: true }).fill("Камера приближается к станции");
  await page.getByRole("combobox", { name: "Длительность", exact: true }).selectOption("10");
  await expect(
    page.getByRole("button", { name: "Сгенерировать видео", exact: true })
  ).toBeDisabled();
  await page.goto("/?surface=sound");
  await expect(
    page.getByRole("heading", { name: "Озвучивание текста", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Подготовить промпт" })).toHaveCount(0);
  expect(writes).toEqual([]);
});
