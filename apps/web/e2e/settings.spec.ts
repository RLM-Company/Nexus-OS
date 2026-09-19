import { expect, test } from "@playwright/test";

test("persists companion and communication settings", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ИИ может писать первой" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" }).check();
  await page.getByLabel("Частота").selectOption("rare");
  await page.getByLabel("Максимум в день").fill("2");
  await page.getByLabel("Тихие часы с").fill("23:00");
  await page.getByLabel("Тихие часы до").fill("07:30");
  await page.getByLabel("Тон").selectOption("direct");
  await page.getByLabel("Подробность").selectOption("short");
  await page.getByLabel("Инициативность").selectOption("proactive");

  await expect(page.getByText(/до 2 сообщений\/день/)).toBeVisible();
  await expect(page.getByText("Напишу только когда есть понятный повод")).toBeVisible();

  await page.reload();

  await expect(page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" })).toBeChecked();
  await expect(page.getByLabel("Частота")).toHaveValue("rare");
  await expect(page.getByLabel("Максимум в день")).toHaveValue("2");
  await expect(page.getByLabel("Тихие часы с")).toHaveValue("23:00");
  await expect(page.getByLabel("Тихие часы до")).toHaveValue("07:30");
  await expect(page.getByLabel("Тон")).toHaveValue("direct");
  await expect(page.getByLabel("Подробность")).toHaveValue("short");
  await expect(page.getByLabel("Инициативность")).toHaveValue("proactive");
});

test("keeps auth preview explicit and does not expose credential inputs", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Вход в Cosmora" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Telegram" })).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("keeps settings usable at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  await expect(page.getByRole("link", { name: "Вход и верификация" })).toBeVisible();
});
