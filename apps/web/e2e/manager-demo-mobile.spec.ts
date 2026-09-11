import { expect, test } from "@playwright/test";

test("keeps the Manager demo usable without horizontal overflow on a phone viewport", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Опишите результат, который хотите получить").fill("Подготовь план демо");
  await page.getByRole("button", { name: "Запустить" }).click();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);

  await page.getByRole("button", { name: "Подготовить Manager plan" }).click();
  const demo = page.locator(".manager-demo");
  await expect(demo).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустить безопасный шаг" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toBeVisible();
  await expect(page.locator(".demo-steps li")).toHaveCount(3);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  expect(
    await page
      .locator(".demo-steps")
      .evaluate((node) => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length)
  ).toBe(1);
});
