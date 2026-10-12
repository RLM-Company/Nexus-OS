import { expect, test, type Page } from "@playwright/test";

const ids = ["ee120001-0001-4000-8000-000000000001", "ee120001-0001-4000-8000-000000000002"];
const projectId = "ee120001-0001-4000-8000-000000000003";
const at = "2026-10-12T10:00:00.000Z";
const chats = ids.map((id, index) => ({
  id,
  title: index ? "Старая беседа" : "Последняя беседа",
  created_at: at,
  updated_at: at,
  last_message_preview: "Заметка"
}));

async function fixture(page: Page, owner = "local-owner") {
  const writes: string[] = [];
  let project = {
    id: projectId,
    title: "Проект задач",
    status: "ACTIVE",
    created_at: at,
    updated_at: at,
    last_message_preview: "План"
  };
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method()))
      writes.push(request.method() + " " + new URL(request.url()).pathname);
  });
  await page.route("**/api/v1/navigation-context", (route) =>
    route.fulfill({ json: { owner_id: owner } })
  );
  await page.route("**/api/v1/chats", (route) => route.fulfill({ json: { items: chats } }));
  await page.route("**/api/v1/projects", (route) => route.fulfill({ json: { items: [project] } }));
  await page.route("**/api/v1/chats/*", (route) => {
    const chat = chats.find((item) => new URL(route.request().url()).pathname.endsWith(item.id));
    return chat
      ? route.fulfill({
          json: {
            chat,
            messages: [
              {
                id: chat.id + "-1",
                chat_id: chat.id,
                role: "user",
                content_type: "text",
                content: "Сохранённое сообщение",
                status: "completed",
                run_id: null,
                error_code: null,
                created_at: at,
                updated_at: at
              }
            ]
          }
        })
      : route.continue();
  });
  await page.route(`**/api/v1/projects/${projectId}`, (route) => {
    if (route.request().method() === "PATCH") {
      project = {
        ...project,
        title: (route.request().postDataJSON() as { title: string }).title,
        updated_at: "2026-10-12T11:00:00.000Z"
      };
      return route.fulfill({ json: { project } });
    }
    return route.fulfill({ json: { project, chat_id: projectId, messages: [] } });
  });
  await page.goto(`/?chat=${ids[0]}`);
  await expect(page.locator(".topbar h1")).toHaveText(chats[0]!.title);
  return writes;
}

test("pins persist per owner, reorder only on pinning and survive ordinary chat reads", async ({
  page
}) => {
  const writes = await fixture(page);
  const labels = page.locator("#sidebar-chat-list .chat-item strong");
  await expect(labels).toHaveText(chats.map((chat) => chat.title));
  await page.locator(`[aria-describedby="pin-chat-${ids[1]}"]`).click();
  await expect(labels).toHaveText([chats[1]!.title, chats[0]!.title]);
  await page.locator("#sidebar-chat-list .chat-item").filter({ hasText: chats[0]!.title }).click();
  await expect(labels).toHaveText([chats[1]!.title, chats[0]!.title]);
  await page.reload();
  await expect(labels).toHaveText([chats[1]!.title, chats[0]!.title]);
  await page.route("**/api/v1/navigation-context", (route) =>
    route.fulfill({ json: { owner_id: "other-owner" } })
  );
  await page.reload();
  await expect(labels).toHaveText(chats.map((chat) => chat.title));
  expect(writes).toEqual([]);
});

test("Ctrl K searches and navigates without losing the draft; other dialogs keep their boundary", async ({
  page
}) => {
  const writes = await fixture(page);
  const composer = page.getByLabel("Сообщение Kosmora", { exact: true });
  await composer.fill("Мой черновик");
  await composer.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Быстрый переход", exact: true });
  const input = dialog.getByLabel("Найти чат, проект или раздел");
  await expect(input).toBeFocused();
  await input.fill("старая");
  await input.press("ArrowDown");
  await expect(dialog.getByRole("button", { name: /Старая беседа/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue("Мой черновик");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Найти в переписке", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Поиск в переписке" });
  await search.getByLabel("Найти в этой переписке").press("Control+k");
  await expect(dialog).toBeHidden();
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Быстрый переход", exact: true }).click();
  await input.fill("старая");
  await input.press("Enter");
  await expect(page.locator(".topbar h1")).toHaveText("Старая беседа");
  expect(writes).toEqual([]);
});

test("renames a project, keeps pins and restores title on reload with one PATCH", async ({
  page
}) => {
  const writes = await fixture(page);
  await page.goto(`/?project=${projectId}&view=project`);
  const panel = page.getByRole("tabpanel", { name: "Проект", exact: true });
  await panel.getByLabel("Название проекта", { exact: true }).fill("Новое название проекта");
  await panel.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Новое название проекта");
  await expect(page.locator("#sidebar-project-list strong")).toHaveText("Новое название проекта");
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Новое название проекта");
  expect(writes).toEqual([`PATCH /api/v1/projects/${projectId}`]);
});

test("quick switcher fits mobile and empty searches never dispatch actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await fixture(page);
  await page.getByRole("button", { name: "Быстрый переход", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Быстрый переход", exact: true });
  await dialog.getByLabel("Найти чат, проект или раздел").fill("Нет такого результата");
  await expect(dialog).toContainText("Совпадений нет");
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../qa/kosmora-quick-switcher-mobile.png" });
  expect(writes).toEqual([]);
});
