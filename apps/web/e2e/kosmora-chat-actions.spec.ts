import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kosmora:profile-onboarding.v1", "done"));
  await page.goto("/");
});

const editor = (page: Page) => page.getByLabel("Сообщение Kosmora");
const answer = (page: Page) => page.locator(".message.assistant").last();
const send = (page: Page) => page.getByRole("button", { name: "Отправить", exact: true }).click();
const pick = async (page: Page, action: string) => {
  await page.getByRole("button", { name: "Действие с текстом", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
};

test("B5 searches a specific message in place and leaves an unrelated draft intact", async ({
  page
}) => {
  await editor(page).fill("B5 код демо-архива");
  await send(page);
  await expect(answer(page)).toContainText("Обычный ответ B5.");
  await expect(page.getByRole("link", { name: "Демо-архив" })).toHaveCount(0);
  const url = page.url();
  await editor(page).fill("Независимый черновик");
  await page
    .locator(".message.user")
    .first()
    .getByRole("button", { name: "Искать в интернете", exact: true })
    .click();
  await expect(answer(page)).toContainText("Код архива — B5-047.");
  await expect(answer(page).getByRole("link", { name: "Демо-архив" })).toHaveAttribute(
    "href",
    "https://example.org/b5/archive"
  );
  await expect(answer(page)).toContainText("Найденные источники");
  await expect(page).toHaveURL(url);
  await expect(editor(page)).toHaveValue("Независимый черновик");
  await page.reload();
  await expect(answer(page).getByRole("link", { name: "Демо-архив" })).toHaveAttribute(
    "href",
    "https://example.org/b5/archive"
  );
});

for (const [input, error] of [
  ["B5 пустой поиск", "Поиск не нашёл источников по этому запросу."],
  ["B5 сбой поиска", "Поиск сейчас недоступен. Попробуйте позже."]
] as const) {
  test(input, async ({ page }) => {
    await editor(page).fill(input);
    await page.getByRole("checkbox", { name: "Искать в интернете" }).check();
    await send(page);
    await expect(answer(page)).toContainText(error);
    await expect(answer(page).getByRole("link")).toHaveCount(0);
    await page.getByRole("button", { name: /Вернуть запрос в редактор/ }).click();
    await expect(editor(page)).toHaveValue(input);
    await expect(page.getByRole("checkbox", { name: "Искать в интернете" })).toBeChecked();
  });
}

for (const [action, input, result] of [
  ["Объяснить тему", "B5 дисперсия", "Дисперсия показывает разброс значений вокруг среднего."],
  ["Дать подсказку", "B5 2(x + 3) = 10", "Сначала раздели обе части уравнения на 2."],
  ["Разобрать решение", "B5 2(x + 3) = 10", "Разделим обе части на 2: x + 3 = 5. Вычтем 3: x = 2."],
  [
    "Проверить ответ",
    "B5 2(x + 3) = 10. Мой ответ x = 3.",
    "При x = 3 левая часть равна 12. Верный ответ x = 2."
  ]
] as const) {
  test(`B5 учебное действие — ${action}`, async ({ page }) => {
    await editor(page).fill(input);
    await pick(page, action);
    await send(page);
    await expect(answer(page)).toContainText(result);
  });
}

test("B5 rewrites just the selected fragment, retains it across reload and supports repeating", async ({
  page
}) => {
  const original = "Ответьте, пожалуйста, сегодня.";
  const input = "B5 " + original + " Внутренняя заметка.";
  const run = async () => {
    await editor(page).fill(input);
    await editor(page).evaluate((element, length) => {
      (element as HTMLTextAreaElement).setSelectionRange(3, 3 + length);
    }, original.length);
    await pick(page, "Переписать текст");
    await expect(page.getByRole("group", { name: "Параметры новой версии" })).toBeVisible();
    await page.getByLabel("Тон", { exact: true }).selectOption("деловой");
    await page.getByLabel("Объём", { exact: true }).selectOption("shorter");
    await send(page);
    await expect(answer(page)).toContainText("Просим ответить сегодня.");
    await expect(answer(page)).toContainText("Новая версия");
  };
  await run();
  await page.reload();
  await expect(answer(page)).toContainText("Просим ответить сегодня.");
  const source = page.locator(".message.user").first();
  await source.getByText("Исходный фрагмент", { exact: true }).click();
  await expect(source.locator("blockquote")).toHaveText(original);
  await run();
  const versions = page.locator(".message.assistant").filter({ hasText: "Новая версия" });
  await expect(versions).toHaveCount(2);
  await expect(versions.getByText("Просим ответить сегодня.", { exact: true })).toHaveCount(2);
});

test("B5 rejects empty and oversized selections and preserves the draft", async ({ page }) => {
  const short = "B5 текст без выделения";
  await editor(page).fill(short);
  await editor(page).evaluate((element) =>
    (element as HTMLTextAreaElement).setSelectionRange(0, 0)
  );
  await pick(page, "Переписать текст");
  await expect(page.locator(".kosmora-composer-actions").getByRole("alert")).toContainText(
    "Выделите фрагмент текста"
  );
  await expect(editor(page)).toHaveValue(short);
  const long = "x".repeat(8001);
  await editor(page).fill(long);
  await editor(page).evaluate((element) => (element as HTMLTextAreaElement).select());
  await pick(page, "Переписать текст");
  await expect(page.locator(".kosmora-composer-actions").getByRole("alert")).toContainText(
    "Сократите выделение до 8 000 символов"
  );
  await expect(editor(page)).toHaveValue(long);
  await expect(page.locator(".message.user")).toHaveCount(0);
});

test("B5 cancelled action restores its original input and action", async ({ page }) => {
  await editor(page).fill("B5 ожидание");
  await pick(page, "Дать подсказку");
  await send(page);
  await expect(answer(page)).toContainText("B5 ожидает остановки.");
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await page.getByRole("button", { name: /Вернуть запрос в редактор/ }).click();
  await expect(editor(page)).toHaveValue("B5 ожидание");
  await expect(page.getByRole("button", { name: "Дать подсказку", exact: true })).toBeVisible();
});
