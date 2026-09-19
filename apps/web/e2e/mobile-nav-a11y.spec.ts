import { expect, test } from "@playwright/test";

test("exposes the active mobile navigation destination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const nav = page.getByRole("navigation", { name: "Мобильная навигация" });
  const newChat = nav.getByRole("button", { name: "Новый чат", exact: true });
  const code = nav.getByRole("button", { name: "Code", exact: true });
  const work = nav.getByRole("button", { name: "Work", exact: true });

  await expect(newChat).toHaveAttribute("aria-current", "page");
  await expect(code).not.toHaveAttribute("aria-current");

  await code.click();
  await expect(code).toHaveAttribute("aria-current", "page");
  await expect(newChat).not.toHaveAttribute("aria-current");

  await work.click();
  await expect(work).toHaveAttribute("aria-current", "page");
  await expect(code).not.toHaveAttribute("aria-current");
});
