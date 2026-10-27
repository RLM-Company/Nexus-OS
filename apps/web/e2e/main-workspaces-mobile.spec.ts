import { expect, test } from "@playwright/test";

const mobileWorkspaces = [
  { button: "Skills", heading: "Skills" },
  { button: "Kosmora Studio", heading: "Kosmora Studio" },
  { button: "Приложения", heading: "Приложения" },
  { button: "Настройки", heading: "Настройки" },
  { button: "Coscode", heading: "Новый чат" },
  { button: "Koswork", heading: "Новый чат" },
  { button: "Изображения", heading: "Создание изображений" },
  { button: "Видео", heading: "Видео" },
  { button: "Sound", heading: "Sound" },
  { button: "Multi-Agent", heading: "Multi-Agent" }
] as const;

test("keeps every main workspace usable at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  await expect(mobileNav).toBeVisible();

  for (const workspace of mobileWorkspaces) {
    const isMode = ["Coscode", "Koswork", "Multi-Agent"].includes(workspace.button);
    await mobileNav
      .getByRole("button", { name: isMode ? "Режимы" : "Все разделы", exact: true })
      .click();
    const menu = page.getByRole("dialog", { name: "Ваше пространство" });
    const destinations = isMode ? menu.locator(".drawer-modes") : menu;
    await destinations
      .getByRole("button", { name: new RegExp(`^${workspace.button}(?:\\s|$)`) })
      .click();
    await expect(menu).not.toBeVisible();
    const isChat = ["Coscode", "Koswork"].includes(workspace.button);
    await expect(page.locator(".topbar h1")).toHaveText(isChat ? "Новый чат" : workspace.button);
    if (isChat) {
      await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toBeEnabled();
      await expect(page.locator(".sidebar")).toHaveAttribute(
        "data-space",
        workspace.button === "Coscode" ? "coscode" : "kosmora"
      );
    } else {
      await expect(
        page
          .locator(".capability-workspace")
          .getByRole("heading", { name: workspace.heading, exact: true })
      ).toBeVisible();
    }

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});
