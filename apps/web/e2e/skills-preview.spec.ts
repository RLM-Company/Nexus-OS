import { expect, test } from "@playwright/test";

test("shows a private instruction editor and inert contract examples", async ({ page }) => {
  await page.goto("/skills");

  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(page.getByText("Инструкции без исполнения", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Новая инструкция" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Примеры контрактов" })).toContainText(
    "Research Brief"
  );
  await expect(page.getByRole("region", { name: "Примеры контрактов" })).toContainText(
    "Document Review"
  );
  await expect(page.getByRole("region", { name: "Примеры контрактов" })).toContainText(
    "GitHub Audit Preview"
  );

  await expect(page.locator("body")).not.toContainText("Authorization");
  await expect(page.locator("body")).not.toContainText("MODEL_API_KEY");
});

test("opens Skills preview from the main workspace", async ({ page }) => {
  await page.goto("/");
  await page.locator(".sidebar-tools").getByRole("button", { name: "Skills", exact: true }).click();
  await page.getByRole("link", { name: /Каталог Skills/ }).click();
  await expect(page).toHaveURL(/\/skills$/);
  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
});

test("keeps Skills preview within a 390x844 viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/skills");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
