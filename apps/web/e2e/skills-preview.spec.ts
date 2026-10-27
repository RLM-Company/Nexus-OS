import { expect, test } from "@playwright/test";

test("shows a private instruction editor and inert contract examples", async ({ page }) => {
  await page.goto("/skills");

  await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
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

test("opens Skills preview from its workspace URL without restoring a sidebar entry", async ({
  page
}) => {
  await page.goto("/?surface=skills");
  await page
    .getByRole("region", { name: "Skills", exact: true })
    .locator('a[href="/skills"]')
    .click();
  await expect(page).toHaveURL(/\/skills$/);
  await expect(page.getByRole("heading", { name: "Skills", exact: true })).toBeVisible();
});

test("keeps Skills preview within a 390x844 viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/skills");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
