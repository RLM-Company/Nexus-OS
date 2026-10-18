import { expect, test } from "@playwright/test";

test("document filters retain selection and the share dialog preserves owner-only access", async ({
  page,
  request
}, info) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Документы дизайна", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}&surface=files`);
  const library = page.getByRole("region", { name: "Библиотека проекта", exact: true });
  await library.locator('input[type="file"]').setInputFiles([
    {
      name: "Бриф.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Цель проекта: единый интерфейс.")
    },
    {
      name: "План.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Шаг первый: проверить результат.")
    }
  ]);
  const documents = library.getByRole("group", { name: "Сохранённые документы", exact: true });
  await expect(documents.getByText("Бриф.txt", { exact: true })).toBeVisible();
  await expect(documents.getByText("План.txt", { exact: true })).toBeVisible();
  await expect(
    library.getByRole("button", { name: "Скачать все оригиналы", exact: true })
  ).toBeEnabled();
  await documents.getByRole("checkbox").first().check();
  await library.getByLabel("Найти документ", { exact: true }).fill("нет такого");
  await expect(documents.getByRole("checkbox")).toHaveCount(0);
  await expect(
    library.getByRole("button", { name: "Скачать оригиналы (1)", exact: true })
  ).toBeEnabled();
  await library.getByRole("button", { name: "Сбросить все", exact: true }).click();
  await expect(documents.getByRole("checkbox").first()).toBeChecked();
  await library.getByRole("button", { name: "Документы сеткой", exact: true }).click();
  await expect(documents).toHaveAttribute("data-view", "grid");
  const writes: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET") writes.push(req.url());
  });
  const share = documents.getByRole("button", { name: "Поделиться файлом Бриф.txt", exact: true });
  await share.click();
  const dialog = page.getByRole("dialog", { name: "Поделиться файлом", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("после входа в Kosmora");
  await expect(dialog.getByLabel("Ссылка на оригинал", { exact: true })).toHaveValue(
    new RegExp(`/api/v1/projects/${project.id}/document-library/[^/]+/download$`)
  );
  await dialog.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(share).toBeFocused();
  expect(writes).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await share.click();
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("file-share-mobile.png"), fullPage: true });
});

test("table cell dialog cancels without data loss and filter chips update the real worker", async ({
  page
}, info) => {
  await page.goto("/?surface=files");
  await page.getByRole("button", { name: "Таблицы и диаграммы", exact: true }).click();
  await page.getByLabel("Открыть таблицу или сохранённый проект", { exact: true }).setInputFiles({
    name: "Демонстрация.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Имя,Сумма\nАльфа,15\nБета,25")
  });
  await page.getByLabel("Тип столбца 2 Сумма", { exact: true }).selectOption("number");
  await page.getByRole("button", { name: "Добавить фильтр", exact: true }).click();
  await page.getByLabel("Столбец фильтра 1", { exact: true }).selectOption("0");
  await page.getByLabel("Значение фильтра 1", { exact: true }).fill("Альфа");
  await expect(page.getByText(/после фильтра: 1$/)).toBeVisible();
  await page.getByRole("button", { name: "Сбросить все", exact: true }).click();
  await expect(page.getByText(/после фильтра: 2$/)).toBeVisible();
  await page.getByLabel("Редактировать ячейки", { exact: true }).check();
  const cell = page.getByRole("button", {
    name: "Изменить ячейку: строка 1, столбец 2",
    exact: true
  });
  await cell.click();
  const dialog = page.getByRole("dialog", { name: "Редактирование ячейки", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Новое значение ячейки", { exact: true }).fill("999");
  await dialog.getByLabel("Новое значение ячейки", { exact: true }).fill("я".repeat(33_000));
  await dialog.getByRole("button", { name: "Применить ячейку", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("64 КиБ");
  await dialog.getByLabel("Новое значение ячейки", { exact: true }).fill("999");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.press("Escape");
  await expect(cell).toHaveText("15");
  await expect(cell).toBeFocused();
  await page.screenshot({ path: info.outputPath("data-workbench-desktop.png"), fullPage: true });
});

test("Enter in model search cannot submit the chat draft", async ({ page }) => {
  await page.goto("/");
  const draft = page.getByLabel("Сообщение Kosmora", { exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill("Это черновик, который нельзя отправлять из поиска модели");
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      /\/api\/v1\/(?:chats|projects)(?:\/|$)/.test(new URL(request.url()).pathname)
    )
      writes.push(request.url());
  });
  await page.getByLabel("Выбор модели", { exact: true }).click();
  const search = page.getByLabel("Найти модель", { exact: true });
  await search.fill("несуществующая модель");
  await search.press("Enter");
  await expect(search).toBeFocused();
  await expect(draft).toHaveValue("Это черновик, который нельзя отправлять из поиска модели");
  await expect(page.locator(".topbar h1")).toHaveText("Новый чат");
  expect(writes).toEqual([]);
});

test("Canvas toolbar formats the selection, supports undo and leaves the document unsaved", async ({
  page,
  request
}, info) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Canvas toolbar", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}&view=chat`);
  await page.getByRole("button", { name: "Открыть Canvas", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  const text = canvas.getByLabel("Содержимое", { exact: true });
  await expect(text).toBeEnabled();
  await text.fill("Привет, Kosmora");
  await text.press("ControlOrMeta+Home");
  await text.press("ControlOrMeta+Shift+End");
  await canvas.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(text).toHaveValue("**Привет, Kosmora**");
  await expect(text).toBeFocused();
  await canvas.getByRole("button", { name: "Отменить форматирование", exact: true }).click();
  await expect(text).toHaveValue("Привет, Kosmora");
  await canvas.getByRole("button", { name: "Заголовок", exact: true }).click();
  await expect(text).toHaveValue("## Привет, Kosmora");
  await expect(canvas).toContainText("Есть несохранённые изменения");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    canvas.getByRole("toolbar", { name: "Форматирование Markdown", exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("canvas-toolbar-mobile.png"), fullPage: true });
});
