import { expect, test } from "@playwright/test";

test("shows a mock-only Skills catalog with permission previews", async ({ page }) => {
  await page.goto("/skills");

  await expect(page.getByRole("heading", { name: "Skills" })).toBeVisible();
  await expect(page.getByText("Preview only", { exact: true })).toBeVisible();
  await expect(page.getByTestId("skills-catalog")).toContainText("Research Brief");
  await expect(page.getByTestId("skills-catalog")).toContainText("Document Review");
  await expect(page.getByTestId("skills-catalog")).toContainText("GitHub Audit Preview");
  await expect(page.getByTestId("skills-catalog")).toContainText("Контекстный компрессор");
  await expect(page.getByTestId("skills-catalog")).toContainText("Короткий результат");
  await expect(page.getByText("Read-only").first()).toBeVisible();

  const disabledRunButtons = page.getByRole("button", { name: "Запуск отключён" });
  await expect(disabledRunButtons).toHaveCount(5);
  for (let index = 0; index < 5; index += 1) {
    await expect(disabledRunButtons.nth(index)).toBeDisabled();
  }

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
