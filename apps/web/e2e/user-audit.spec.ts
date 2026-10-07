import { expect, test, type Page } from "@playwright/test";

const auditProject = {
  id: "audit-project",
  title: "Audit Project",
  status: "ACTIVE",
  created_at: "2026-09-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z"
} as const;

const installShellFixture = async (
  page: Page,
  options?: { includeProject?: boolean; projectMessages?: unknown[] }
) => {
  const includeProject = options?.includeProject ?? false;
  const projectMessages = options?.projectMessages ?? [];

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (request.method() !== "GET") {
      await route.continue();
      return;
    }

    let body: unknown;
    if (path === "/api/v1/projects") {
      body = { items: includeProject ? [auditProject] : [] };
    } else if (path === "/api/v1/chats") {
      body = { items: [] };
    } else if (path === "/api/v1/model-runtime") {
      body = {
        mode: "mock",
        provider: "mock",
        model: "audit-fixture",
        registry_version: "audit-registry",
        credential_configured: false,
        fallback_to_mock: false
      };
    } else if (path === "/api/v1/operations/status") {
      body = { process_stop: null };
    } else if (path === "/api/v1/operations/emergency-stop") {
      body = null;
    } else if (path === `/api/v1/projects/${auditProject.id}`) {
      body = {
        project: auditProject,
        chat_id: "audit-chat",
        messages: projectMessages
      };
    } else if (path.endsWith("/autonomy-profile")) {
      body = { profile: { base_level: "A0", version: 1 } };
    } else if (path.endsWith("/manager-demo-runs")) {
      body = { items: [] };
    } else if (path.endsWith("/confirmations")) {
      body = { items: [] };
    } else if (path.endsWith("/recovery-required")) {
      body = { items: [], limit: 50 };
    } else {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
};

const longProjectHistory = Array.from({ length: 24 }, (_, index) => ({
  id: `audit-message-${index}`,
  project_id: auditProject.id,
  chat_id: "audit-chat",
  role: index % 2 === 0 ? "user" : "assistant",
  content_type: "text",
  content: `Сообщение ${index + 1}: проверка прокрутки длинной истории на мобильном экране.`,
  status: "completed",
  reply_to_message_id: null,
  run_id: `audit-run-${Math.floor(index / 2)}`,
  error_code: null,
  created_at: "2026-09-18T00:00:00.000Z",
  updated_at: "2026-09-18T00:00:00.000Z"
}));

const waitForProjectList = async (page: Page): Promise<void> => {
  const projectButton = page
    .locator(".mobile-project-strip")
    .getByRole("button", { name: auditProject.title, exact: true });
  await expect(projectButton).toBeVisible();
};

test("reaches every primary workspace from the phone navigation", async ({ page }) => {
  await installShellFixture(page, { includeProject: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForProjectList(page);

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  await expect(mobileNav).toBeVisible();

  await mobileNav.getByRole("button", { name: "Все разделы" }).click();
  await page
    .getByRole("dialog", { name: "Ваше пространство" })
    .getByRole("button", { name: auditProject.title, exact: true })
    .click();
  await expect(page.locator(".topbar h1")).toHaveText("Audit Project");

  for (const label of ["Skills", "Code", "Work", "Изображения", "Видео", "Sound", "Мультиагент"]) {
    await mobileNav.getByRole("button", { name: "Все разделы" }).click();
    await page
      .getByRole("dialog", { name: "Ваше пространство" })
      .getByRole("button", { name: new RegExp(`^${label}(?:\\s|$)`) })
      .click();
    await expect(page.locator(".topbar h1")).toHaveText(label);
  }

  await mobileNav.getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Новый чат");
});

test("keeps mobile navigation, composer and long-chat scrolling usable", async ({ page }) => {
  await installShellFixture(page, {
    includeProject: true,
    projectMessages: longProjectHistory
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await waitForProjectList(page);

  const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
  await mobileNav.getByRole("button", { name: "Все разделы" }).click();
  await page
    .getByRole("dialog", { name: "Ваше пространство" })
    .getByRole("button", { name: auditProject.title, exact: true })
    .click();

  const composer = page.getByLabel("Сообщение менеджеру");
  const messages = page.locator(".messages");
  await expect(composer).toBeVisible();
  await expect(mobileNav).toBeVisible();
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(messages).toBeVisible();
  expect(await messages.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);

  await messages.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(async () => messages.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);

  await composer.fill("Проверка мобильного composer");
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("does not render secret fields returned alongside model runtime metadata", async ({
  page
}) => {
  const secretMarker = "sk-audit-secret-marker";
  await page.route("**/api/v1/operations/status", async (route) => {
    await route.fulfill({ json: { process_stop: null } });
  });
  await page.route("**/api/v1/model-runtime", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        mode: "openai-compatible",
        provider: "audit-provider",
        model: "audit-model",
        registry_version: "audit-registry",
        credential_configured: true,
        fallback_to_mock: false,
        api_key: secretMarker,
        secret: "MODEL_API_KEY=must-not-render"
      })
    });
  });

  await page.goto("/model-status");
  await expect(page.getByTestId("runtime-readiness")).toContainText("Провайдер настроен");
  await expect(page.locator("body")).not.toContainText(secretMarker);
  await expect(page.locator("body")).not.toContainText("MODEL_API_KEY=must-not-render");
});

test("shows a readable API failure and preserves the unsent message", async ({ page }) => {
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: { message: "Сервис временно недоступен. Повторите попытку." }
        })
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const composer = page.getByLabel("Сообщение Kosmora");
  await composer.fill("Сообщение, которое нельзя потерять");
  await page.getByRole("button", { name: "Отправить" }).click();

  await expect(page.locator(".composer-footer")).toContainText(
    "Сервис временно недоступен. Повторите попытку."
  );
  await expect(composer).toHaveValue("Сообщение, которое нельзя потерять");
  await expect(page.getByRole("button", { name: "Отправить" })).toBeEnabled();
});

test("keeps sidebar focus on keyboard-operated controls", async ({ page }) => {
  await installShellFixture(page);
  await page.goto("/");

  const sidebar = page.locator(".sidebar");
  const newChat = sidebar.getByRole("button", { name: "Новый чат" });
  const chats = sidebar.getByRole("button", { name: /Чаты/ });
  const projects = sidebar.getByRole("button", { name: /Проекты/ });

  await newChat.focus();
  await page.keyboard.press("Tab");
  await expect(sidebar.getByLabel("Поиск чатов и проектов")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(chats).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(chats).toBeFocused();
  await expect(chats).toHaveAttribute("aria-expanded", "false");

  await page.keyboard.press("Tab");
  await expect(sidebar.locator(".chat-archive-panel summary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(projects).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(projects).toBeFocused();
  await expect(projects).toHaveAttribute("aria-expanded", "false");

  for (const name of ["Work", "Code", "Мультиагент", "Skills"]) {
    const destination = page.locator(".sidebar-tools").getByRole("button", { name, exact: true });
    await page.keyboard.press("Tab");
    await expect(destination).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(destination).toBeFocused();
    await expect(page.locator(".topbar h1")).toHaveText(name);
  }
});
