import { expect, test } from "@playwright/test";

const project = {
  id: "context-alpha",
  title: "Project Context Alpha",
  status: "ACTIVE",
  created_at: "2026-09-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z"
};

const mockProjectApi = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;

    if (path === "/api/v1/projects") {
      body = { items: [{ ...project, last_message_preview: "Контекст проекта" }] };
    } else if (path === "/api/v1/chats") {
      body = { items: [] };
    } else if (path === "/api/v1/model-runtime") {
      body = {
        mode: "mock",
        provider: "mock",
        model: "fixture",
        credential_configured: false,
        fallback_to_mock: false
      };
    } else if (path === "/api/v1/projects/context-alpha") {
      body = { project, chat_id: "context-alpha-chat", messages: [] };
    } else if (path.endsWith("/autonomy-profile")) {
      body = { profile: { base_level: "A0", version: 1 } };
    } else {
      body = { items: [] };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
};

test("rejects duplicate persisted Project Context source ids", async ({ page }) => {
  await mockProjectApi(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cosmora:project-context:context-alpha",
      JSON.stringify({
        sources: [
          {
            id: "duplicate",
            title: "First",
            kind: "document",
            summary: "First source",
            size: 100,
            connected: true
          },
          {
            id: "duplicate",
            title: "Second",
            kind: "document",
            summary: "Second source",
            size: 100,
            connected: true
          }
        ]
      })
    );
  });

  await page.goto("/?context_preview=1&project=context-alpha&view=context");

  await expect(
    page.getByRole("alert").filter({ hasText: "Локальное состояние повреждено" })
  ).toHaveCount(1);
  await expect(
    page.getByRole("tabpanel", { name: "Контекст проекта" }).getByText("Подключено 2 из 3")
  ).toBeVisible();
});

test("rejects persisted Project Context sources above the 64k connected budget", async ({
  page
}) => {
  await mockProjectApi(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cosmora:project-context:context-alpha",
      JSON.stringify({
        sources: [
          {
            id: "large-a",
            title: "Large A",
            kind: "document",
            summary: "Large source A",
            size: 40_000,
            connected: true
          },
          {
            id: "large-b",
            title: "Large B",
            kind: "document",
            summary: "Large source B",
            size: 40_000,
            connected: true
          }
        ]
      })
    );
  });

  await page.goto("/?context_preview=1&project=context-alpha&view=context");

  await expect(
    page.getByRole("alert").filter({ hasText: "Локальное состояние повреждено" })
  ).toHaveCount(1);
  await expect(
    page.getByRole("tabpanel", { name: "Контекст проекта" }).getByText("13 800 / 64 000 токенов")
  ).toBeVisible();
});

test("prevents connecting a Project Context source above the 64k budget", async ({ page }) => {
  await mockProjectApi(page);
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cosmora:project-context:context-alpha",
      JSON.stringify({
        sources: [
          {
            id: "connected",
            title: "Connected",
            kind: "document",
            summary: "Connected source",
            size: 50_000,
            connected: true
          },
          {
            id: "too-large",
            title: "Too large",
            kind: "document",
            summary: "Would exceed the context budget",
            size: 20_000,
            connected: false
          }
        ]
      })
    );
  });

  await page.goto("/?context_preview=1&project=context-alpha&view=context");

  const panel = page.getByRole("tabpanel", { name: "Контекст проекта" });
  await expect(panel.getByText("50 000 / 64 000 токенов")).toBeVisible();
  await panel.getByRole("button", { name: "Подключить" }).click();

  const preview = page.getByRole("dialog", { name: "Too large" });
  await expect(preview.getByRole("alert")).toContainText(
    "Источник не подключён: будет превышен лимит 64 000 токенов."
  );
  await expect(preview.getByRole("button", { name: "Подключить источник" })).toBeDisabled();
  await expect(panel.getByText("Подключено 1 из 2")).toBeVisible();
});
