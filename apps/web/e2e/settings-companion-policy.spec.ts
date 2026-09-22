import { expect, test } from "@playwright/test";

test("persists owner-controlled Companion policy limits", async ({ page }) => {
  await page.goto("/settings");

  const minGap = page.getByLabel("Минимальный интервал, мин");
  const backoff = page.getByLabel("Backoff после молчания");
  const suppressActive = page.getByRole("checkbox", { name: "Не писать при активном диалоге" });

  await expect(minGap).toBeDisabled();
  await expect(backoff).toBeDisabled();
  await expect(suppressActive).toBeDisabled();

  await page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" }).check();
  await minGap.fill("30");
  await backoff.fill("2");
  await suppressActive.uncheck();

  await page.reload();

  await expect(minGap).toHaveValue("30");
  await expect(backoff).toHaveValue("2");
  await expect(suppressActive).not.toBeChecked();

  const stored = await page.evaluate(() => {
    const envelope = JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}") as {
      companion?: {
        min_gap_minutes?: unknown;
        backoff_after_unanswered?: unknown;
        suppress_when_active?: unknown;
      };
    };
    return envelope.companion;
  });

  expect(stored).toMatchObject({
    min_gap_minutes: 30,
    backoff_after_unanswered: 2,
    suppress_when_active: false
  });
});

test("keeps Companion policy numeric inputs integral and contract-bounded", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" }).check();

  const minGap = page.getByLabel("Минимальный интервал, мин");
  const backoff = page.getByLabel("Backoff после молчания");

  await minGap.fill("1.5");
  await expect(minGap).toHaveValue("120");
  await minGap.fill("1441");
  await expect(minGap).toHaveValue("1440");
  await minGap.fill("-1");
  await expect(minGap).toHaveValue("0");

  await backoff.fill("1.5");
  await expect(backoff).toHaveValue("3");
  await backoff.fill("11");
  await expect(backoff).toHaveValue("10");
  await backoff.fill("-1");
  await expect(backoff).toHaveValue("0");
});
