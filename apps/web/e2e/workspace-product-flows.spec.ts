import { expect, test } from "@playwright/test";

test("exports the selected Studio parameters and restores isolated drafts", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url());
  });
  await page.goto("/");
  const sidebar = page.locator(".sidebar-tools");
  await sidebar.getByRole("button", { name: /Cosmora Studio/ }).click();
  await sidebar.getByRole("button", { name: "Sound", exact: true }).click();
  await expect(page.getByRole("button", { name: "Короткий", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.getByLabel("Промпт для аудио").fill("Спокойная музыка без вокала");
  await page.getByRole("button", { name: "Средний", exact: true }).click();
  await page.getByRole("combobox", { name: "Стиль", exact: true }).selectOption("Музыка");
  await page.getByRole("button", { name: "Подготовить промпт" }).click();
  const output = page.locator(".capability-workspace pre");
  await expect(output).toContainText("Формат: Средний");
  await expect(output).toContainText("Стиль: Музыка");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать .txt" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe("cosmora-sound-prompt.txt");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  expect(Buffer.concat(chunks).toString("utf8")).toContain(
    "Формат: Средний\nСтиль: Музыка\n\nСпокойная музыка без вокала"
  );
  await sidebar.getByRole("button", { name: "Видео", exact: true }).click();
  await expect(page.getByLabel("Промпт для видео")).toHaveValue("");
  await sidebar.getByRole("button", { name: "Sound", exact: true }).click();
  await expect(page.getByLabel("Промпт для аудио")).toHaveValue("Спокойная музыка без вокала");
  await page.reload();
  await expect(page.getByLabel("Промпт для аудио")).toHaveValue("Спокойная музыка без вокала");
  await expect(page.getByRole("button", { name: "Средний", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  expect(writes).toEqual([]);
});

test("transfers a Code brief into an unsent chat draft", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST") writes.push(request.url());
  });
  await page.goto("/");
  const tools = page.locator(".sidebar-tools");
  await tools.getByRole("button", { name: "Code", exact: true }).click();
  await page.getByLabel("Описание задачи разработки").fill("Добавить поиск по названиям проектов");
  await page.getByLabel(/Критерии готовности/).fill("Поиск не зависит от регистра");
  await tools.getByRole("button", { name: "Work", exact: true }).click();
  await tools.getByRole("button", { name: "Code", exact: true }).click();
  await expect(page.getByLabel("Описание задачи разработки")).toHaveValue(
    "Добавить поиск по названиям проектов"
  );
  await page.getByRole("button", { name: "Обсудить с Cosmora" }).click();
  const composer = page.getByLabel("Сообщение Cosmora");
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
