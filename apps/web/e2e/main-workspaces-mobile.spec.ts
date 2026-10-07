import { expect, test } from "@playwright/test";

const mobileWorkspaces = [
  { button: "Skills", heading: "Skills" },
  { button: "Kosmora Studio", heading: "Kosmora Studio" },
  { button: "Приложения", heading: "Приложения" },
  { button: "Настройки", heading: "Настройки" },
  { button: "Code", heading: "Code" },
  { button: "Work", heading: "Work" },
  { button: "Изображения", heading: "Создание изображений" },
  { button: "Видео", heading: "Видео" },
  { button: "Sound", heading: "Sound" },
  { button: "Мультиагент", heading: "Мультиагент" }
] as const;

test("keeps every main workspace usable at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  await expect(mobileNav).toBeVisible();

  for (const workspace of mobileWorkspaces) {
    const isMode = workspace.button === "Code" || workspace.button === "Work";
    await mobileNav
      .getByRole("button", { name: isMode ? "Режимы" : "Все разделы", exact: true })
      .click();
    const menu = page.getByRole("dialog", { name: "Ваше пространство" });
    const destinations = isMode ? menu.locator(".drawer-modes") : menu;
    await destinations
      .getByRole("button", { name: new RegExp(`^${workspace.button}(?:\\s|$)`) })
      .click();
    await expect(menu).not.toBeVisible();
    await expect(page.locator(".topbar h1")).toHaveText(workspace.button);
    await expect(
      page
        .locator(".capability-workspace")
        .getByRole("heading", { name: workspace.heading, exact: true })
    ).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});
