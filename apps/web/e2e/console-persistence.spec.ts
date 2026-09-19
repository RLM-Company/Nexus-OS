import { expect, test } from "@playwright/test";

test("persists a selected workspace across reload without creating a project", async ({ page }) => {
  let projectPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/projects")) {
      projectPosts += 1;
    }
  });

  await page.goto("/");
  const sidebar = page.locator(".sidebar-tools");
  await sidebar.getByRole("button", { name: "Work", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Work");

  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Work");
  expect(projectPosts).toBe(0);
});

test("keeps the persisted workspace usable at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  await mobileNav.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Code");

  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Code");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
