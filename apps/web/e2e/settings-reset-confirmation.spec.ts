import { expect, test } from "@playwright/test";

test("requires explicit confirmation before resetting Settings", async ({ page }) => {
  await page.goto("/settings");

  await page.getByLabel("Тон").selectOption("direct");
  await expect(page.getByLabel("Тон")).toHaveValue("direct");

  await page.getByRole("button", { name: "Сбросить настройки" }).click();

  const confirmation = page.getByRole("group", { name: "Подтверждение сброса" });
  await expect(confirmation).toBeVisible();
  await expect(page.getByLabel("Тон")).toHaveValue("direct");

  await confirmation.getByRole("button", { name: "Отмена" }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(page.getByLabel("Тон")).toHaveValue("direct");

  await page.getByRole("button", { name: "Сбросить настройки" }).click();
  await page.getByRole("button", { name: "Подтвердить сброс" }).click();

  await expect(page.getByLabel("Тон")).toHaveValue("natural");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stored = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
          communication?: { tone?: unknown };
        };
        return stored.communication?.tone;
      })
    )
    .toBe("natural");
});
