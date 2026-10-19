import { expect, test } from "@playwright/test";

const installNavigationFixture = async (page: import("@playwright/test").Page) => {
  const items = Array.from({ length: 9 }, (_, index) => ({
    id: `search-chat-${index}`,
    title: index === 8 ? "Особый девятый чат" : `Разговор ${index + 1}`,
    created_at: "2026-09-27T12:00:00.000Z",
    updated_at: "2026-09-27T12:00:00.000Z",
    last_message_preview: null
  }));
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items })
      });
    else await route.continue();
  });
};

test("search opens collapsed desktop history and can be cleared", async ({ page }) => {
  await installNavigationFixture(page);
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.getByRole("button", { name: /Особый девятый чат/ })).toBeVisible();
  await sidebar.getByRole("button", { name: /Чаты 9/ }).click();
  await expect(sidebar.getByRole("button", { name: /Особый девятый чат/ })).toBeHidden();
  const search = sidebar.getByRole("textbox", { name: "Поиск чатов и проектов" });
  await search.fill("  ОСОБЫЙ  ");
  await expect(sidebar.getByRole("button", { name: /Особый девятый чат/ })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /Разговор 1/ })).toBeHidden();
  await sidebar.getByRole("button", { name: "Очистить поиск" }).click();
  await expect(search).toBeFocused();
  await expect(sidebar.getByRole("button", { name: /Разговор 1/ })).toBeVisible();
});

test("mobile search reaches chats beyond the recent six", async ({ page }) => {
  await installNavigationFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Все разделы" }).click();
  const drawer = page.getByRole("dialog", { name: "Ваше пространство" });
  await expect(drawer.getByRole("button", { name: "Особый девятый чат" })).toHaveCount(0);
  const search = drawer.getByRole("textbox", { name: "Поиск чатов и проектов" });
  await search.fill("особый");
  await expect(drawer.getByRole("button", { name: "Особый девятый чат" })).toBeVisible();
  await search.press("Escape");
  await expect(drawer).toBeVisible();
  await expect(search).toHaveValue("");
  await search.press("Escape");
  await expect(drawer).toBeHidden();
});

test("opens the Studio overview directly from a shared preview link", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cosmora:workspace-surface", "code"));
  await page.goto("/?surface=studio");
  await expect(
    page.locator(".capability-workspace").getByRole("heading", { name: "Kosmora Studio" })
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Изображения" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Видео" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sound" })).toBeVisible();
  await expect(page.locator(".studio-section")).toContainText("Обзор Studio");
});

test("shows a searchable plan with real entry points and honest future requirements", async ({
  page
}) => {
  await page.goto("/?surface=features");
  await expect(
    page.locator(".capability-workspace").getByRole("heading", { name: "Возможности", exact: true })
  ).toBeVisible();
  await expect(page.getByText("10 в планах")).toBeVisible();
  await page.getByRole("button", { name: "Команда", exact: true }).click();
  await expect(page.getByText("Коллективный Work")).toBeVisible();
  await expect(page.getByText("Глубинное исследование")).toBeHidden();
  await page.getByText("Коллективный Work").click();
  await expect(page.getByText(/Главный владелец управляет ролями/)).toBeVisible();
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await page.getByRole("textbox", { name: "Поиск возможностей" }).fill("автономность");
  await expect(page.getByText("Custom автономность")).toBeVisible();
  await page.getByRole("textbox", { name: "Поиск возможностей" }).fill("");
  await page.getByRole("button", { name: /Studio.*Редакторы промптов/ }).click();
  await expect(
    page.locator(".capability-workspace").getByRole("heading", { name: "Kosmora Studio" })
  ).toBeVisible();
  await expect(page).toHaveURL(/surface=studio/);
});

test("opens Studio from its sidebar folder and keeps a shareable surface URL", async ({ page }) => {
  await page.goto("/?surface=work");
  await page
    .locator(".sidebar-tools")
    .getByRole("button", { name: /Kosmora Studio/ })
    .click();
  await expect(
    page.locator(".capability-workspace").getByRole("heading", { name: "Kosmora Studio" })
  ).toBeVisible();
  await expect(page).toHaveURL(/surface=studio/);
  await page.reload();
  await expect(
    page.locator(".capability-workspace").getByRole("heading", { name: "Kosmora Studio" })
  ).toBeVisible();
});

test("restores separate media settings without automatic generation", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && !request.url().endsWith("/chat-navigation/import-pins"))
      writes.push(request.url());
  });
  await page.goto("/?surface=images");
  await page.getByLabel("Описание изображения", { exact: true }).fill("Станция у моря");
  await page.getByRole("button", { name: "16:9", exact: true }).click();
  await page.getByRole("combobox", { name: "Стиль", exact: true }).selectOption("Кино");
  await page.goto("/?surface=video");
  await page.getByLabel("Описание сцены", { exact: true }).fill("Волны и движение камеры");
  await page.getByRole("combobox", { name: "Длительность", exact: true }).selectOption("10");
  await page.goto("/?surface=images");
  await expect(page.getByLabel("Описание изображения", { exact: true })).toHaveValue(
    "Станция у моря"
  );
  await expect(page.getByRole("button", { name: "16:9", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByRole("combobox", { name: "Стиль", exact: true })).toHaveValue("Кино");
  await page.goto("/?surface=video");
  await expect(page.getByLabel("Описание сцены", { exact: true })).toHaveValue(
    "Волны и движение камеры"
  );
  await expect(page.getByRole("combobox", { name: "Длительность", exact: true })).toHaveValue("10");
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Длительность", exact: true })).toHaveValue("10");
  expect(writes).toEqual([]);
});

test("transfers a Code brief into an unsent chat draft", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && !request.url().endsWith("/chat-navigation/import-pins"))
      writes.push(request.url());
  });
  await page.goto("/");
  const modeTrigger = page.getByLabel("Режимы Kosmora", { exact: true });
  const modeMenu = page.locator(".workspace-mode-menu");
  await modeTrigger.click();
  await modeMenu.getByRole("button", { name: /^Code(?:\s|$)/ }).click();
  await page.getByLabel("Описание задачи разработки").fill("Добавить поиск по названиям проектов");
  await page.getByLabel(/Критерии готовности/).fill("Поиск не зависит от регистра");
  await modeTrigger.click();
  await modeMenu.getByRole("button", { name: /^Work(?:\s|$)/ }).click();
  await modeTrigger.click();
  await modeMenu.getByRole("button", { name: /^Code(?:\s|$)/ }).click();
  await expect(page.getByLabel("Описание задачи разработки")).toHaveValue(
    "Добавить поиск по названиям проектов"
  );
  await page.getByRole("button", { name: "Обсудить с Kosmora" }).click();
  const composer = page.getByLabel("Сообщение Kosmora");
  await expect(composer).toHaveValue(/Добавить поиск по названиям проектов/);
  await expect(composer).toHaveValue(/Поиск не зависит от регистра/);
  await expect(composer).toBeFocused();
  expect(writes).toEqual([]);
});

test("opens and dismisses the owner menu and persists UI preferences", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByLabel("Аккаунт владельца", { exact: true });
  await trigger.click();
  await expect(page.getByRole("button", { name: "Аккаунт и настройки" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Аккаунт и настройки" })).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.locator(".topbar h1").click();
  await expect(page.getByRole("button", { name: "Аккаунт и настройки" })).toBeHidden();
  await trigger.click();
  await page.getByRole("button", { name: "Аккаунт и настройки" }).click();
  await page.getByRole("checkbox", { name: /Компактная навигация/ }).check();
  await page.getByRole("checkbox", { name: /Увеличенный текст/ }).check();
  await expect(page.locator(".app-shell")).toHaveClass(/compact-navigation/);
  await expect(page.locator(".app-shell")).toHaveClass(/large-text/);
  await page.reload();
  await expect(page.getByRole("checkbox", { name: /Компактная навигация/ })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: /Увеличенный текст/ })).toBeChecked();
});

test("recovers from invalid Studio drafts and UI preferences", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem(
      "cosmora:studio-draft:sound",
      JSON.stringify({ prompt: 123, format: "16:9", style: "invalid" })
    );
    localStorage.setItem(
      "cosmora:ui-preferences",
      JSON.stringify({ compact: "true", largeText: [] })
    );
    localStorage.setItem("cosmora:workspace-surface", "sound");
  });
  await page.goto("/");
  await expect(page.getByLabel("Промпт для аудио")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Короткий", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(page.getByRole("combobox", { name: "Стиль", exact: true })).toHaveValue("Авто");
  await expect(page.locator(".app-shell")).not.toHaveClass(/compact-navigation|large-text/);
});
