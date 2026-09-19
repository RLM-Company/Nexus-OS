import { expect, test } from "@playwright/test";

const surfaces = [
  ["Skills", "Skills"],
  ["Code", "Code"],
  ["Work", "Work"],
  ["Изображения", "Создание изображений"],
  ["Видео", "Видео"],
  ["Sound", "Sound"],
  ["Мультиагент", "Мультиагент"]
] as const;

test("keeps every capability workspace mobile and write-free", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      writes.push(request.url());
    }
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  for (const [buttonName, headingName] of surfaces) {
    await mobileNav.getByRole("button", { name: buttonName, exact: true }).click();
    await expect(page.getByRole("heading", { name: headingName, exact: true })).toBeVisible();
    const fitsViewport = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    );
    expect(fitsViewport).toBe(true);
  }

  expect(writes).toEqual([]);
});

test("keeps every media prompt local until a model is connected", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
      writes.push(request.url());
    }
  });

  await page.goto("/");
  const sidebar = page.locator(".sidebar-tools");
  const media = [
    ["Изображения", "изображения"],
    ["Видео", "видео"],
    ["Sound", "аудио"]
  ] as const;

  for (const [surface, label] of media) {
    await sidebar.getByRole("button", { name: surface, exact: true }).click();
    await page.getByLabel(`Промпт для ${label}`).fill(`Безопасный локальный prompt: ${label}`);
    await page.getByRole("button", { name: "Подготовить промпт" }).click();
    await expect(page.getByRole("status")).toContainText("сохранён локально");
    await expect(page.getByText("Внешняя модель не подключена")).toBeVisible();
  }

  expect(writes).toEqual([]);
});
