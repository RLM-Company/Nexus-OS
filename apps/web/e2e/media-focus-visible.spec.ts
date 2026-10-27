import { expect, test } from "@playwright/test";

test("shows a visible keyboard focus ring on media prompt textareas", async ({ page }) => {
  await page.goto("/");
  await page
    .locator(".sidebar-tools")
    .getByRole("button", { name: /Kosmora Studio/ })
    .click();
  await page.getByRole("button", { name: "Изображения", exact: true }).click();

  const prompt = page.getByLabel("Описание изображения", { exact: true });
  await prompt.focus();
  await expect(prompt).toBeFocused();

  const focusStyle = await prompt.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth
    };
  });

  expect(focusStyle.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(focusStyle.outlineWidth)).toBeGreaterThan(0);
});
