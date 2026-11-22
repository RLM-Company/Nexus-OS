import { expect, test, type Page } from "@playwright/test";
import { isWorkspaceWrite } from "./fixtures/navigation-writes";

// First-run profile onboarding has its own spec; its modal would intercept
// clicks here. Mark it done locally without changing product behaviour.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
    } catch {
      /* Storage may be unavailable; the tests still exercise the surface. */
    }
  });
});

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
  const pins = new Map<string, string[]>();
  let project = {
    id: projectId,
    title: "Проект задач",
    status: "ACTIVE",
    created_at: at,
    updated_at: at,
    last_message_preview: "План"
  };
  page.on("request", (request) => {
    if (isWorkspaceWrite(request))
      writes.push(request.method() + " " + new URL(request.url()).pathname);
  });
  const navigation = () => ({
    folders: [],
    assignments: [],
    chats: pins.get(owner) ?? [],
    projects: []
  });
  await page.route("**/api/v1/chat-navigation", (route) => route.fulfill({ json: navigation() }));
  await page.route("**/api/v1/chat-navigation/import-pins", (route) =>
    route.fulfill({ json: navigation() })
  );
  await page.route("**/api/v1/chat-navigation/pins/chats/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const current = pins.get(owner) ?? [];
    pins.set(
      owner,
      route.request().postDataJSON().pinned
        ? [...new Set([...current, id])]
        : current.filter((item) => item !== id)
    );
    return route.fulfill({ json: navigation() });
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
  return {
    writes,
    changeOwner: (next: string) => {
      owner = next;
    }
  };
}

test("integrations show the discovered MCP tool catalog and journal operation", async ({
  page
}) => {
  await fixture(page);
  const operation = "ef130001-0001-4000-8000-000000000001";
  await page.route(`**/api/v1/projects/${projectId}/integrations/mcp`, (route) =>
    route.fulfill({ json: { configured: true, stopped: false } })
  );
  await page.route(`**/api/v1/projects/${projectId}/integrations/mcp/discover`, (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({ request_id: expect.any(String) });
    return route.fulfill({
      json: {
        status: "EXECUTED",
        tools: ["read_fixture"],
        hasMore: false,
        operation_id: operation
      }
    });
  });
  await page.goto("/?surface=apps");
  await expect(page.getByLabel("Проект для MCP")).toHaveValue(projectId);
  const panel = page.getByRole("region", { name: "MCP", exact: true });
  await panel.getByRole("button", { name: "Проверить MCP и показать инструменты" }).click();
  await expect(panel.getByText("read_fixture", { exact: true })).toBeVisible();
  await expect(panel.getByText(operation, { exact: true })).toBeVisible();
});

test("imports a reviewed MCP document and explains access loss", async ({ page }) => {
  await fixture(page);
  const base = `**/api/v1/projects/${projectId}/integrations/mcp`;
  const id = "ef130001-0001-4000-8000-000000000002";
  const report = "a".repeat(32),
    notes = "b".repeat(32);
  const source = "fixture://workspace/report";
  let revoked = false;
  let stopped = false;
  let writes = 0;
  let saves = 0;
  let copyAttempts = 0;
  let copyRequest = "";
  let interruptedRequest = "";
  let receiptChecks = 0;
  await page.route(base, (route) =>
    route.fulfill({
      json: {
        configured: true,
        stopped,
        documents: [
          { id: report, name: "report.txt" },
          { id: notes, name: "notes.txt" }
        ]
      }
    })
  );
  await page.route(base + "/document/preview", (route) => {
    const selected = (route.request().postDataJSON() as { document_id: string }).document_id;
    expect([report, notes]).toContain(selected);
    return route.fulfill(
      revoked
        ? {
            status: 409,
            json: { status: "RECOVERY_REQUIRED", operation_id: id }
          }
        : {
            json: {
              status: "EXECUTED",
              preview_id: id,
              operation_id: id,
              name: selected === notes ? "notes.txt" : "report.txt",
              source: selected === notes ? "fixture://workspace/notes" : source,
              text:
                selected === notes
                  ? "Отдельные заметки."
                  : saves >= 2
                    ? "Обновлённый отчёт."
                    : "19 700 ₽, артикул 00123, кроме доставки."
            }
          }
    );
  });
  await page.route(base + "/document/imports", (route) =>
    route.fulfill({
      json: {
        items: writes
          ? [
              {
                operation_id: id,
                name: "report.txt",
                source,
                sha256: "c".repeat(64),
                version: 2,
                copy: "matched"
              }
            ]
          : []
      }
    })
  );
  await page.route(base + "/document/save", (route) => {
    saves++;
    expect(route.request().postDataJSON()).toEqual({
      preview_id: id,
      document_id: report,
      request_id: expect.any(String)
    });
    if (saves === 2)
      return route.fulfill({
        json: { status: "EXECUTED", operation_id: id, version: 2, already_present: true }
      });
    if (saves === 3)
      return route.fulfill({
        status: 409,
        json: { error: { code: "MCP_DOCUMENT_NAME_CONFLICT" }, copy_name: "report-mcp-1.txt" }
      });
    if (saves === 4)
      return route.fulfill({
        json: {
          status: "EXECUTED",
          operation_id: id,
          version: 3,
          already_present: true,
          existing_name: "report-mcp-1.txt"
        }
      });
    if (saves === 5) {
      interruptedRequest = (route.request().postDataJSON() as { request_id: string }).request_id;
      return route.abort();
    }
    writes++;
    return route.fulfill({ json: { status: "EXECUTED", operation_id: id, version: 2 } });
  });
  await page.route(base + "/document/status?*", (route) => {
    receiptChecks++;
    expect(route.request().method()).toBe("GET");
    const query = new URL(route.request().url()).searchParams;
    expect(query.get("request_id")).toBe(interruptedRequest);
    expect(query.get("document_id")).toBe(report);
    if (receiptChecks === 1) return route.fulfill({ json: { status: "UNKNOWN" } });
    return route.fulfill({
      json: { status: "EXECUTED", operation_id: id, version: 4, copy_name: "report.txt" }
    });
  });
  await page.route(base + "/document/save-copy", (route) => {
    copyAttempts++;
    const payload = route.request().postDataJSON() as { request_id: string };
    expect(payload).toEqual({
      preview_id: id,
      document_id: report,
      request_id: expect.any(String)
    });
    if (!copyRequest) {
      copyRequest = payload.request_id;
      return route.abort();
    }
    expect(payload.request_id).toBe(copyRequest);
    if (copyAttempts === 2)
      return route.fulfill({ status: 504, json: { message: "Gateway timeout" } });
    return route.fulfill({
      json: { status: "EXECUTED", operation_id: id, version: 3, copy_name: "report-mcp-1.txt" }
    });
  });
  await page.goto("/?surface=apps");
  const selector = page.getByLabel("Документ для импорта");
  await selector.selectOption(notes);
  const document = page.getByRole("region", { name: "Документ MCP", exact: true });
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await expect(document).toContainText("Отдельные заметки.");
  await selector.selectOption(report);
  await expect(
    document.getByRole("button", { name: "Подтвердить сохранение в материалы" })
  ).toHaveCount(0);
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await expect(document).toContainText("19 700 ₽, артикул 00123, кроме доставки.");
  await expect(document).toContainText(source);
  expect(writes).toBe(0);
  await document.getByRole("button", { name: "Подтвердить сохранение в материалы" }).click();
  await expect(document).toContainText("Документ сохранён. Версия материалов: 2.");
  expect(writes).toBe(1);
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await document.getByRole("button", { name: "Подтвердить сохранение в материалы" }).click();
  await expect(document).toContainText("Точная копия уже в материалах.");
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await document.getByRole("button", { name: "Подтвердить сохранение в материалы" }).click();
  await expect(document).toContainText("Существующая копия сохранена.");
  expect(writes).toBe(1);
  expect(copyRequest).toBe("");
  await expect(document).toContainText("Обновлённый отчёт.");
  const saveCopy = document.getByRole("button", { name: "Сохранить как report-mcp-1.txt" });
  await saveCopy.click();
  await expect(document).toContainText("Ответ потерян.");
  await saveCopy.click();
  await expect(document).toContainText("Результат запроса неизвестен.");
  await saveCopy.click();
  await expect(document).toContainText(
    "Документ сохранён как report-mcp-1.txt. Версия материалов: 3."
  );
  expect(copyAttempts).toBe(3);
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await document.getByRole("button", { name: "Подтвердить сохранение в материалы" }).click();
  await expect(document).toContainText("Точная копия уже в материалах (report-mcp-1.txt).");
  await expect(saveCopy).toHaveCount(0);
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await document.getByRole("button", { name: "Подтвердить сохранение в материалы" }).click();
  await expect(document).toContainText("Ответ потерян.");
  stopped = true;
  await page.reload();
  await expect(document).not.toContainText("Обновлённый отчёт.");
  const receipt = document.getByRole("button", { name: "Проверить результат сохранения" });
  await receipt.click();
  await expect(document.getByRole("button", { name: "Предпросмотр документа" })).toHaveCount(0);
  await expect(document).toContainText("Журнал пока не подтверждает исход сохранения.");
  await receipt.click();
  await expect(document).toContainText("Документ сохранён как report.txt. Версия материалов: 4.");
  await expect(receipt).toHaveCount(0);
  expect(saves).toBe(5);
  expect(receiptChecks).toBe(2);
  stopped = false;
  revoked = true;
  await page.reload();
  await document.getByRole("button", { name: "Предпросмотр документа" }).click();
  await expect(document).toContainText("Документ недоступен.");
  await expect(
    document.getByRole("button", { name: "Подтвердить сохранение в материалы" })
  ).toHaveCount(0);
  await page.reload();
  const history = page.getByRole("region", { name: "История импорта MCP", exact: true });
  await history.getByRole("button", { name: "История импорта MCP" }).click();
  await expect(history).toContainText(source);
  await expect(history).toContainText("Версия материалов: 2. В материалах есть точная копия.");
  await expect(history).toContainText("c".repeat(64));
  expect(writes).toBe(1);
});

test("pins persist per owner, reorder only on pinning and survive ordinary chat reads", async ({
  page
}) => {
  const { writes, changeOwner } = await fixture(page);
  const labels = page.locator("#sidebar-chat-list .chat-item strong");
  await expect(labels).toHaveText(chats.map((chat) => chat.title));
  await page.getByLabel(`Действия с чатом «${chats[1]!.title}»`, { exact: true }).click();
  await page
    .getByRole("dialog", { name: `Меню чата «${chats[1]!.title}»`, exact: true })
    .getByRole("button", { name: "Закрепить", exact: true })
    .click();
  await expect(labels).toHaveText([chats[1]!.title, chats[0]!.title]);
  await page.locator("#sidebar-chat-list .chat-item").filter({ hasText: chats[0]!.title }).click();
  await expect(labels).toHaveText([chats[1]!.title, chats[0]!.title]);
  await page.reload();
  await expect(labels).toHaveText([chats[1]!.title, chats[0]!.title]);
  changeOwner("other-owner");
  await page.reload();
  await expect(labels).toHaveText(chats.map((chat) => chat.title));
  expect(writes).toEqual([`PUT /api/v1/chat-navigation/pins/chats/${ids[1]}`]);
});

test("Ctrl K searches and navigates without losing the draft; other dialogs keep their boundary", async ({
  page
}) => {
  const { writes } = await fixture(page);
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
  await page.keyboard.press("Control+k");
  await input.fill("старая");
  await input.press("Enter");
  await expect(page.locator(".topbar h1")).toHaveText("Старая беседа");
  expect(writes).toEqual([]);
});

test("renames a project, keeps pins and restores title on reload with one PATCH", async ({
  page
}) => {
  const { writes } = await fixture(page);
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
  const { writes } = await fixture(page);
  await page.keyboard.press("Control+k");
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
