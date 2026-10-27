import { expect, test } from "@playwright/test";

test("shows the safe mock-only GitHub read-only dashboard", async ({ page }) => {
  await page.goto("/github/preview");

  await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
  await expect(page.getByTestId("github-ready")).toContainText("Read-only");
  await expect(page.getByRole("region", { name: "Репозитории" })).toContainText(
    "RLM-Company/Nexus-OS"
  );
  await expect(page.getByRole("region", { name: "Ветки" })).toContainText("main");
  await expect(page.getByRole("region", { name: "Commits" })).toContainText("403ed71");
  await expect(page.getByRole("region", { name: "Issues" })).toContainText("#150");
  await expect(page.getByRole("region", { name: "Pull requests" })).toContainText("#151");
  await expect(page.getByRole("region", { name: "CI status" })).toContainText("success");
  await expect(page.getByRole("button", { name: /Создание ветки/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Слияние pull request/ })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("Authorization");
  await expect(page.locator("body")).not.toContainText("token");
});

test("shows empty, offline and generic error states without internal details", async ({ page }) => {
  await page.goto("/github/preview?state=empty");
  await expect(page.getByTestId("github-empty")).toBeVisible();

  await page.goto("/github/preview?state=offline");
  await expect(page.getByTestId("github-offline")).toBeVisible();
  await page.getByTestId("github-retry").click();
  await expect(page.getByTestId("github-ready")).toBeVisible();

  await page.goto("/github/preview?state=error");
  await expect(page.getByTestId("github-error")).toContainText("Внутренние детали не отображаются");
  await expect(page.locator("body")).not.toContainText("stack");
});

test("keeps the GitHub preview within the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/github/preview");
  await expect(page.getByTestId("github-readonly-card")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
});
