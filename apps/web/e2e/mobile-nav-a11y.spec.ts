import { expect, test } from "@playwright/test";

test("exposes the active mobile navigation destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Мобильная навигация" });
  const newChat = nav.getByRole("button", { name: "Новый чат", exact: true });
  const modes = nav.getByRole("button", { name: "Режимы", exact: true });
  const drawer = page.getByRole("dialog", { name: "Ваше пространство" });
  const modeRows = drawer.locator(".drawer-modes");
  const code = modeRows.getByRole("button", { name: /^Code(?:\s|$)/ });
  const work = modeRows.getByRole("button", { name: /^Work(?:\s|$)/ });

  await expect(newChat).toHaveAttribute("aria-current", "page");
  await expect(modes).not.toHaveAttribute("aria-current");
  await expect(nav.getByRole("button")).toHaveCount(4);

  await modes.click();
  await code.click();
  await expect(drawer).toBeHidden();
  await expect(modes).toHaveAttribute("aria-current", "page");
  await expect(newChat).not.toHaveAttribute("aria-current");

  await modes.click();
  await expect(code).toHaveAttribute("aria-current", "page");
  await expect(work).not.toHaveAttribute("aria-current");
  await work.click();
  await modes.click();
  await expect(work).toHaveAttribute("aria-current", "page");
  await expect(code).not.toHaveAttribute("aria-current");
  await modeRows.getByRole("button", { name: /^Чат(?:\s|$)/ }).click();
  await expect(drawer).toBeHidden();
  await expect(newChat).toHaveAttribute("aria-current", "page");
  await expect(modes).not.toHaveAttribute("aria-current");
});
