import { expect, test } from "@playwright/test";

const mobileWorkspaces = [
  { button: "Skills", heading: "Skills" },
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
    await mobileNav.getByRole("button", { name: workspace.button, exact: true }).click();
    await expect(page.locator(".topbar h1")).toHaveText(workspace.button);
    await expect(page.getByRole("heading", { name: workspace.heading })).toBeVisible();

    const layout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  }
});
