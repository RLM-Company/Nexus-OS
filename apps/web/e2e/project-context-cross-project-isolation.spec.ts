import { expect, test } from "@playwright/test";

const project = (id: string, title: string) => ({
  id,
  title,
  status: "ACTIVE",
  created_at: "2026-09-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z",
  last_message_preview: title
});

const alpha = project("context-alpha", "Context Alpha");
const beta = project("context-beta", "Context Beta");

test("keeps Project Context browser state isolated while switching projects in one SPA session", async ({
  page
}) => {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path === "/api/v1/projects") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [alpha, beta] })
      });
      return;
    }

    if (path === "/api/v1/chats") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [] })
      });
      return;
    }

    if (path === "/api/v1/model-runtime") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          mode: "mock",
          provider: "mock",
          model: "fixture",
          credential_configured: false,
          fallback_to_mock: false
        })
      });
      return;
    }

    const match = path.match(/^\/api\/v1\/projects\/(context-alpha|context-beta)$/);
    if (match) {
      const selected = match[1] === "context-alpha" ? alpha : beta;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          project: selected,
          chat_id: `${selected.id}-chat`,
          messages: []
        })
      });
      return;
    }

    if (path.endsWith("/autonomy-profile")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ profile: { base_level: "A0", version: 1 } })
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [] })
    });
  });

  await page.goto("/?project=context-alpha&view=context");

  let panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  await expect(panel.getByText("Подключено 2 из 3")).toBeVisible();
  await panel.getByRole("button", { name: "Отключить" }).first().click();
  await expect(panel.getByText("Подключено 1 из 3")).toBeVisible();

  await page
    .locator("#sidebar-project-list")
    .getByRole("button", { name: /Context Beta/ })
    .click();
  await page.getByRole("tab", { name: "Контекст" }).click();

  panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  await expect(panel.getByText("Подключено 2 из 3")).toBeVisible();
  await panel.getByRole("button", { name: "Подключить" }).click();
  await page
    .getByRole("dialog", { name: "Project handoff" })
    .getByRole("button", { name: "Подключить источник" })
    .click();
  await expect(panel.getByText("Подключено 3 из 3")).toBeVisible();

  await page
    .locator("#sidebar-project-list")
    .getByRole("button", { name: /Context Alpha/ })
    .click();
  await page.getByRole("tab", { name: "Контекст" }).click();

  panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  await expect(panel.getByText("Подключено 1 из 3")).toBeVisible();

  const stored = await page.evaluate(() => ({
    alpha: window.localStorage.getItem("cosmora:project-context:context-alpha"),
    beta: window.localStorage.getItem("cosmora:project-context:context-beta")
  }));
  expect(stored.alpha).not.toBeNull();
  expect(stored.beta).not.toBeNull();
  expect(stored.alpha).not.toBe(stored.beta);
});
