import { expect, test, type Page } from "@playwright/test";
const editorFor = (page: Page) =>
  page.getByRole("region", { name: "Редактор презентации", exact: true });
async function create(page: Page) {
  await page.goto("/presentations");
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill(`Редактор ${crypto.randomUUID()}`);
  await page.getByRole("button", { name: "+ Создать", exact: true }).click();
  await expect(editorFor(page)).toBeVisible();
}
test("undo survives save with current version; redo and structural edits preserve slide selection", async ({
  page
}) => {
  await create(page);
  const editor = editorFor(page);
  const heading = editor.getByLabel("Заголовок", { exact: true });
  const initial = await heading.inputValue();
  await heading.fill("Новая версия");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(heading).toHaveValue(initial);
  const saving = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes("/presentations/")
  );
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  expect((await saving).status()).toBe(200);
  await editor.getByRole("button", { name: "Повторить правку", exact: true }).click();
  await expect(heading).toHaveValue("Новая версия");
  await editor.getByRole("button", { name: "Дублировать", exact: true }).click();
  await editor.getByRole("button", { name: "Удалить слайд", exact: true }).click();
  await editor.getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(editor.getByRole("button", { name: "↓ Ниже", exact: true })).toBeDisabled();
  await heading.press("Control+z");
  await expect(editor.getByRole("button", { name: "Удалить слайд", exact: true })).toBeDisabled();
  await heading.fill("Новая ветка правок");
  await expect(
    editor.getByRole("button", { name: "Повторить правку", exact: true })
  ).toBeDisabled();
});
test("literal reviewed bulk replacement includes notes only explicitly and is a single undo", async ({
  page
}) => {
  await create(page);
  const editor = editorFor(page);
  await editor.getByLabel("Основной текст", { exact: true }).fill("Байкал и байкал <b>");
  await editor.getByRole("textbox", { name: /Заметки докладчика/ }).fill("байкал");
  await editor.getByText("Поиск и замена", { exact: true }).click();
  await editor.getByLabel("Найти в слайдах").fill("байкал");
  await editor.getByLabel("Заменить на").fill("$& <script>");
  await expect(
    editor.getByRole("button", { name: "Заменить все (2)", exact: true })
  ).toBeDisabled();
  await editor.getByLabel("Включить заметки докладчика").check();
  await editor.getByLabel(/Проверил замену/).check();
  await editor.getByRole("button", { name: "Заменить все (3)", exact: true }).click();
  await expect(editor.getByLabel("Основной текст", { exact: true })).toHaveValue(
    "$& <script> и $& <script> <b>"
  );
  await expect(editor.getByRole("textbox", { name: /Заметки докладчика/ })).toHaveValue(
    "$& <script>"
  );
  await editor.getByRole("button", { name: "Отменить правку", exact: true }).click();
  await expect(editor.getByLabel("Основной текст", { exact: true })).toHaveValue(
    "Байкал и байкал <b>"
  );
  await expect(editor.getByRole("textbox", { name: /Заметки докладчика/ })).toHaveValue("байкал");
  await editor.getByRole("button", { name: "Слайд 1 · Основной текст · 1", exact: true }).click();
  await expect(editor.getByLabel("Основной текст", { exact: true })).toBeFocused();
});
test("new local edits invalidate restoration review and opening another deck clears undo", async ({
  page
}) => {
  await create(page);
  const editor = editorFor(page);
  await editor.getByLabel("Заголовок", { exact: true }).fill("Вторая версия");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await editor.getByRole("button", { name: "История версий", exact: true }).click();
  await editor.getByRole("button", { name: "Посмотреть версию 1", exact: true }).click();
  await editor.getByLabel("Проверил изменения перед восстановлением").check();
  const restore = editor.getByRole("button", { name: "Восстановить версию 1", exact: true });
  await expect(restore).toBeEnabled();
  await editor.getByLabel("Заголовок", { exact: true }).fill("Несохранённая правка");
  await expect(restore).toBeDisabled();
  await expect(editor.getByText("Несохранённая правка", { exact: true }).last()).toBeVisible();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "+ Создать", exact: true }).click();
  await expect(editor.getByRole("button", { name: "Отменить правку", exact: true })).toBeDisabled();
});
test("lost save response reconciles once, then undo saves against the recovered version", async ({
  page
}) => {
  await create(page);
  const editor = editorFor(page);
  await editor.getByLabel("Заголовок", { exact: true }).fill("Принято сервером");
  let writes = 0;
  await page.route("**/api/v1/presentations/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    if (writes === 1) {
      expect((await route.fetch()).status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  expect(writes).toBe(1);
  await editor.getByRole("button", { name: "Отменить правку", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  expect(writes).toBe(2);
});
