import { expect, test } from "@playwright/test";

/** Stage-three: separate Music section and removal of the Studio overview. */
test("Music is a separate section and honestly reports an unconnected provider", async ({
  page
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
      localStorage.removeItem("cosmora:workspace-surface");
    } catch {
      /* Storage may be unavailable. */
    }
  });
  await page.goto("/?surface=music");
  await expect(page.getByRole("heading", { name: "Music", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText("Генерация музыки не подключена")).toBeVisible();
  const generate = page.getByRole("button", { name: "Сгенерировать музыку" });
  await expect(generate).toBeDisabled();
  // No fake result and no paid media request.
  await expect(page.getByRole("button", { name: /Скачать/ })).toHaveCount(0);
  const paid: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/media/"))
      paid.push(request.url());
  });
  expect(paid).toEqual([]);
});

test("the Studio overview catalog is no longer reachable", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
      localStorage.removeItem("cosmora:workspace-surface");
    } catch {
      /* Storage may be unavailable. */
    }
  });
  await page.goto("/?surface=studio");
  await expect(page).toHaveURL(/surface=files/);
  await expect(page.getByRole("heading", { name: "Kosmora Studio", level: 2 })).toHaveCount(0);
  // Sidebar still exposes the real tools, including Music.
  const studio = page.locator(".studio-section");
  await expect(studio.getByRole("button", { name: "Music", exact: true })).toBeVisible();
  await expect(studio.getByRole("button", { name: "Sound", exact: true })).toBeVisible();
});
