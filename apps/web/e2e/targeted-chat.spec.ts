import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

async function mode(page: Page, name: string) {
  await page.getByLabel("Режимы Kosmora", { exact: true }).click();
  await page.locator(".workspace-mode-menu").getByRole("button", { name, exact: true }).click();
}
async function seed(request: APIRequestContext, label: string, chatMode: string) {
  const created = await request.post("http://127.0.0.1:3100/api/v1/chats", {
    data: { initial_message: label, client_message_id: crypto.randomUUID(), mode: chatMode }
  });
  expect(created.status(), await created.text()).toBe(201);
  return created.json() as Promise<{ chat: { id: string }; run_id: string }>;
}

test("voice defaults to empty composer, text transforms it and search replaces switcher", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Открыть голосового помощника", exact: true })
  ).toBeEnabled();
  await expect(
    page.locator(".topbar").getByRole("button", { name: "Быстрый переход" })
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Поиск в чате", exact: true })).toBeVisible();
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill("Черновик");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Открыть голосового помощника", exact: true })
  ).toHaveCount(0);
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill("");
  await page.getByRole("button", { name: "Открыть голосового помощника", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Голосовой помощник", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Вернуться в чат", exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
    const mic = await page.getByLabel("Голосовой ввод", { exact: true }).boundingBox();
    const send = await page
      .getByRole("button", { name: "Открыть голосового помощника", exact: true })
      .boundingBox();
    expect(mic!.x + mic!.width).toBeLessThanOrEqual(send!.x + 4);
    await page.screenshot({ path: `../../qa/targeted-chat-${width}.png` });
  }
});

test("Kosmora and Work share navigation; Coscode isolates its chats and includes Work", async ({
  page,
  request
}) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const normal = await seed(request, `Обычный ${tag}`, "kosmora");
  const work = await seed(request, `Рабочий ${tag}`, "work");
  await seed(request, `Код ${tag}`, "coscode");
  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Обычный ${tag}` })).toBeVisible();
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Рабочий ${tag}` })).toBeVisible();
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Код ${tag}` })).toHaveCount(0);
  await expect(sidebar.getByText("Папки чатов", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("Архив чатов", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Сообщение Kosmora", { exact: true })
    .fill("Сохранить черновик при смене режима");
  await mode(page, "Kosmora Work");
  await expect(sidebar).toHaveAttribute("data-space", "kosmora");
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(
    "Сохранить черновик при смене режима"
  );
  await mode(page, "Coscode");
  await expect(sidebar).toHaveAttribute("data-space", "coscode");
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Код ${tag}` })).toBeVisible();
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Обычный ${tag}` })).toHaveCount(0);
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Рабочий ${tag}` })).toBeVisible();
  await sidebar
    .locator(".chat-item")
    .filter({ hasText: `Рабочий ${tag}` })
    .click();
  await expect(page).toHaveURL(new RegExp(work.chat.id));
  await expect(sidebar).toHaveAttribute("data-space", "coscode");
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-space", "coscode");
  await expect(sidebar.locator(".chat-item").filter({ hasText: `Обычный ${tag}` })).toHaveCount(0);
  await mode(page, "Kosmora");
  await expect(sidebar).toHaveAttribute("data-space", "kosmora");
  expect(normal.chat.id).toBeTruthy();
});

test("chat ellipsis supports rename, pin and cancellation of deletion; current chat search finds text", async ({
  page
}) => {
  await page.goto("/");
  const title = `Орбита ${crypto.randomUUID().slice(0, 8)}`;
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText(title);
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Поиск в чате", exact: true }).click();
  await page.getByRole("textbox", { name: "Найти в этой переписке", exact: true }).fill("Орбита");
  await expect(page.getByRole("dialog", { name: "Поиск в переписке" })).toContainText(title);
  await page.getByRole("button", { name: "Закрыть поиск", exact: true }).click();
  const ellipsis = page.getByLabel(`Действия с чатом «${title}»`, { exact: true });
  await expect(ellipsis).toBeVisible();
  await ellipsis.click();
  const menu = page.getByLabel(`Меню чата «${title}»`, { exact: true });
  await menu.getByRole("button", { name: "Переименовать", exact: true }).click();
  await menu.getByLabel("Название чата").fill(title + " изменён");
  await menu.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText(title + " изменён");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Название чата", exact: true })).toHaveValue(
    title + " изменён"
  );
  await page.getByLabel("Настройки чата", { exact: true }).press("Escape");
  const next = page.getByLabel(`Действия с чатом «${title} изменён»`, { exact: true });
  await next.click();
  await page
    .getByLabel(`Меню чата «${title} изменён»`, { exact: true })
    .getByRole("button", { name: "Удалить чат", exact: true })
    .click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText(title + " изменён");
});

test("model and effort picker persists the effort and fits mobile; Studio routes stay separate", async ({
  page
}) => {
  let effort: string | null = null;
  await page.route("**/api/v1/personal-settings", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({
      json: { ...data, reasoning: { effort, supported_efforts: ["low", "medium", "high"] } }
    });
  });
  await page.route("**/api/v1/personal-settings/reasoning", async (route) => {
    effort = route.request().postDataJSON().effort;
    await route.fulfill({ json: { effort, supported_efforts: ["low", "medium", "high"] } });
  });
  await page.goto("/");
  await expect(page.getByLabel("Выбор модели", { exact: true })).toHaveAttribute(
    "aria-disabled",
    "false"
  );
  await page.getByLabel("Выбор модели", { exact: true }).click();
  await page.getByRole("radio", { name: "Высокие", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Высокие", exact: true })).toHaveAttribute(
    "aria-checked",
    "true"
  );
  expect(effort).toBe("high");
  await page.screenshot({ path: "../../qa/targeted-model-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.locator("[data-model-picker] > div");
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../qa/targeted-model-mobile.png" });
  await page.getByLabel("Выбор модели", { exact: true }).press("Escape");
  await page.goto("/?mode=kosmora");
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toBeEnabled();
  await page
    .getByRole("navigation", { name: "Мобильная навигация" })
    .getByRole("button", { name: "Studio", exact: true })
    .click();
  await expect(page).toHaveURL(/surface=studio/);
  expect(new URL(page.url()).searchParams.has("mode")).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Kosmora Studio", exact: true, level: 2 })
  ).toBeVisible();
  for (const title of ["Анализ файлов", "Deep Research", "Презентации", "Сайты", "Games"])
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});
