import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
async function project(request: APIRequestContext) {
  const r = await request.post("/api/v1/projects/empty", {
    data: { title: "Поиск и источники", client_project_id: randomUUID() }
  });
  expect(r.ok()).toBe(true);
  return (await r.json()).project.id as string;
}
test("Canvas literal search, replace/undo and limits preserve the current draft", async ({
  page,
  request
}) => {
  const id = await project(request);
  await page.goto(`/?project=${id}&surface=files`);
  const initial = "# Заметка\nОрбита. орбита. орбита. 😀\n";
  await page
    .getByLabel("Крупный документ")
    .setInputFiles({ name: "note.md", mimeType: "text/markdown", buffer: Buffer.from(initial) });
  await page.getByRole("button", { name: "Редактировать в Canvas", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Документ в Canvas", exact: true });
  const area = modal.getByLabel("Содержимое", { exact: true });
  await expect(area).toHaveValue(initial);
  await area.press("Control+f");
  const search = modal.getByLabel("Найти", { exact: true });
  await expect(search).toBeFocused();
  await search.fill("орбита");
  await expect(modal.getByRole("status").filter({ hasText: "Совпадений:" })).toContainText("3");
  await modal.getByLabel("Учитывать регистр", { exact: true }).check();
  await expect(modal.getByRole("status").filter({ hasText: "Совпадений:" })).toContainText("2");
  await modal.getByLabel("Заменить на", { exact: true }).fill("$& мир");
  await modal.getByRole("button", { name: "Заменить все", exact: true }).click();
  const changed = "# Заметка\nОрбита. $& мир. $& мир. 😀\n";
  await expect(area).toHaveValue(changed);
  await modal.getByRole("button", { name: "Отменить замену", exact: true }).click();
  await expect(area).toHaveValue(initial);
  await modal.getByRole("button", { name: "Повторить замену", exact: true }).click();
  await expect(area).toHaveValue(changed);
  await area.fill(changed + "Ручная правка");
  await expect(modal.getByRole("button", { name: "Отменить замену", exact: true })).toBeDisabled();
  await search.fill("$&");
  await modal.getByRole("button", { name: "Следующее совпадение", exact: true }).click();
  expect(
    await area.evaluate((el) => {
      if (!(el instanceof HTMLTextAreaElement)) throw new Error("Expected the source textarea");
      return el.value.slice(el.selectionStart, el.selectionEnd);
    })
  ).toBe("$&");
  await search.fill("x");
  await area.fill("x".repeat(10_001));
  await expect(modal.getByRole("status").filter({ hasText: "Более" })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Заменить все", exact: true })).toBeDisabled();
  await area.fill("xxxx");
  await modal.getByLabel("Заменить на", { exact: true }).fill("я".repeat(70_000));
  await modal.getByRole("button", { name: "Заменить все", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("512 КиБ");
  await expect(area).toHaveValue("xxxx");
  await modal.getByLabel("Заменить на", { exact: true }).fill("готово");
  await modal.getByRole("button", { name: "Заменить совпадение", exact: true }).click();
  await expect(area).toHaveValue("готовоxxx");
  await search.press("Escape");
  await expect(modal).toBeVisible();
  await expect(area).toBeFocused();
  await modal.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("Артефакт создан");
  await area.press("Control+f");
  await search.fill("готово");
  await page.screenshot({ path: "../../qa/studio-canvas-search.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: "../../qa/studio-canvas-search-mobile.png", fullPage: true });
});

test("library selection respects hidden files and source links reveal exact late lines", async ({
  page,
  request
}) => {
  const id = await project(request);
  let answer: unknown[] = [];
  await page.route(`**/projects/${id}/document-library/answers`, (route) =>
    route.fulfill({ json: { answers: answer, available: true } })
  );
  await page.goto(`/?project=${id}&surface=files`);
  const library = page.getByRole("region", { name: "Библиотека проекта", exact: true });
  const budget =
    "Начало документа.\n" + "Строка подробностей.\n".repeat(2500) + "Бюджет проекта: 42000 рублей.";
  await library.locator('input[type="file"]').setInputFiles([
    { name: "budget.txt", mimeType: "text/plain", buffer: Buffer.from(budget) },
    { name: "deadline.txt", mimeType: "text/plain", buffer: Buffer.from("Срок проекта — октябрь") }
  ]);
  await expect(library.locator('li[data-upload-state="ready"]')).toHaveCount(2);
  const docs = library.getByRole("group", { name: "Сохранённые документы", exact: true });
  const filter = library.getByLabel("Найти документ по имени", { exact: true });
  await filter.fill("budget");
  await expect(docs.getByRole("checkbox")).toHaveCount(1);
  await library.getByRole("button", { name: "Выбрать видимые", exact: true }).click();
  await filter.fill("deadline");
  await expect(docs.getByRole("checkbox")).toHaveCount(1);
  await expect(library.getByText(/скрыто фильтром: 1/)).toBeVisible();
  await library.getByRole("button", { name: "Выбрать видимые", exact: true }).click();
  await library.getByRole("button", { name: "Снять выбор видимых", exact: true }).click();
  await library.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
  await expect(docs.getByRole("checkbox", { name: /budget.txt/ })).toBeChecked();
  await expect(docs.getByRole("checkbox", { name: /deadline.txt/ })).not.toBeChecked();
  await library.getByLabel("Состояние документа", { exact: true }).selectOption("failed");
  await expect(library.getByText("Документов по этим фильтрам нет.")).toBeVisible();
  await library.getByRole("button", { name: "Сбросить фильтры", exact: true }).click();
  await library.getByLabel("Вопрос к документам").fill("Бюджет");
  await library.getByRole("button", { name: "Найти источники", exact: true }).click();
  const source = library.getByRole("button", { name: /Открыть источник budget.txt/ }).first();
  await source.click();
  const viewer = page.getByRole("dialog", { name: "budget.txt", exact: true });
  await expect(viewer.getByLabel("Цитируемые строки", { exact: true })).toContainText("42000");
  await expect(viewer.getByLabel("Цитируемые строки", { exact: true })).toBeInViewport();
  await page.screenshot({ path: "../../qa/studio-source-citation.png", fullPage: true });
  expect(Number(await viewer.getByLabel("Часть текста оригинала").inputValue())).toBeGreaterThan(0);
  await expect(viewer.getByLabel("Текст оригинала")).not.toContainText("Начало документа");
  await viewer.getByLabel("Поиск в предпросмотре").fill("Начало документа");
  await expect(viewer.getByLabel("Найденный текст", { exact: true })).toHaveText(
    "Начало документа"
  );
  await expect(viewer.getByLabel("Найденный текст", { exact: true })).toBeInViewport();
  await expect(viewer.getByLabel("Текст оригинала")).toContainText("Начало документа");
  await page.screenshot({ path: "../../qa/studio-source-reader.png", fullPage: true });
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await library.getByLabel("Вопрос к документам").fill("Новый вопрос");
  await library
    .getByRole("button", { name: "Редактировать подборку в Canvas", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Документ в Canvas", exact: true });
  await expect(editor.getByLabel("Содержимое", { exact: true })).toHaveValue(/Запрос: Бюджет/);
  await expect(editor.getByLabel("Содержимое", { exact: true })).not.toHaveValue(/Новый вопрос/);
  await editor.getByRole("button", { name: "Закрыть документ Canvas", exact: true }).click();
  const files = (await (await request.get(`/api/v1/projects/${id}/document-library`)).json()).files;
  const fileId = files.find((file: { name: string }) => file.name === "budget.txt").id;
  answer = [
    {
      id: randomUUID(),
      question: "Какой бюджет?",
      answer: "42000 [S1]",
      status: "done",
      error_code: null,
      citations: ["S1"],
      sources: [
        {
          ref: "S1",
          file_id: fileId,
          name: "budget.txt",
          page: null,
          line_start: 2502,
          line_end: 2502,
          content: "Бюджет проекта: 42000 рублей."
        }
      ]
    }
  ];
  await page.reload();
  await library
    .getByLabel("Источники ответа", { exact: true })
    .getByRole("button", { name: "Открыть источник S1", exact: true })
    .click();
  await expect(viewer.getByLabel("Цитируемые строки", { exact: true })).toHaveText(
    "Бюджет проекта: 42000 рублей."
  );
  await page.keyboard.press("Escape");
  await library.getByRole("button", { name: "Предпросмотр budget.txt", exact: true }).click();
  await expect(viewer.getByLabel("Текст оригинала")).toContainText("Начало документа");
  await page.keyboard.press("Escape");
});
