import { expect, test } from "@playwright/test";

test("persists a selected workspace across reload without creating a project", async ({ page }) => {
  let projectPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/projects")) {
      projectPosts += 1;
    }
  });

  await page.goto("/");
  await page.getByLabel("Режимы Kosmora", { exact: true }).click();
  await page
    .locator(".workspace-mode-menu")
    .getByRole("button", { name: /^Work(?:\s|$)/ })
    .click();
  await expect(page.locator(".topbar h1")).toHaveText("Work");

  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Work");
  expect(projectPosts).toBe(0);
});

test("keeps the persisted workspace usable at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  await mobileNav.getByRole("button", { name: "Режимы", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Ваше пространство" })
    .locator(".drawer-modes")
    .getByRole("button", { name: /^Code(?:\s|$)/ })
    .click();
  await expect(page.locator(".topbar h1")).toHaveText("Code");

  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Code");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
