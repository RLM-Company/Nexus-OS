import { expect, test } from "@playwright/test";

for (const surface of ["studio", "skills"] as const) {
  test(`mode menu does not mark Chat as active on ${surface} and keeps mode selection focused`, async ({
    page
  }) => {
    await page.goto(`/?surface=${surface}`);
    const trigger = page.getByLabel("Режимы Kosmora", { exact: true });
    const disclosure = page.locator(".workspace-mode-menu");
    await trigger.click();
    await expect(disclosure).toHaveAttribute("open", "");
    await expect(disclosure.locator('[aria-current="page"]')).toHaveCount(0);

    await disclosure.getByRole("button", { name: "Koswork", exact: true }).click();
    await expect(page).toHaveURL(/(?:\?|&)mode=work(?:&|$)/);
    await expect(page.locator(".topbar h1")).toHaveText("Новый чат");
    await expect(page.getByRole("button", { name: "Работа", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(disclosure).not.toHaveAttribute("open");
    await expect(trigger).toBeFocused();
  });
}

test("clicking outside the mode menu keeps the target focus and unsent message", async ({
  page
}) => {
  await page.goto("/");
  const composer = page.getByLabel("Сообщение Kosmora", { exact: true });
  const draft = "Продолжить обсуждение этой идеи, сохранив черновик";
  await composer.fill(draft);
  const trigger = page.getByLabel("Режимы Kosmora", { exact: true });
  const disclosure = page.locator(".workspace-mode-menu");
  await trigger.click();
  await expect(disclosure).toHaveAttribute("open", "");

  await composer.click();
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue(draft);
});

test("Escape closes the mode menu from its buttons and after tabbing outside", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByLabel("Режимы Kosmora", { exact: true });
  const disclosure = page.locator(".workspace-mode-menu");
  await trigger.click();
  const lastMode = disclosure.getByRole("button", { name: "Multi-Agent", exact: true });
  await lastMode.focus();
  await page.keyboard.press("Escape");
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();

  await trigger.press("Enter");
  await expect(disclosure).toHaveAttribute("open", "");
  await lastMode.focus();
  await page.keyboard.press("Tab");
  await expect(
    page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true })
  ).toBeFocused();
  await expect(disclosure).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(disclosure).not.toHaveAttribute("open");
  await expect(trigger).toBeFocused();
});
