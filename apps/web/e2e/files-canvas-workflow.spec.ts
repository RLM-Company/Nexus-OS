import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

test("two documents become an editable cited Canvas report without overwriting the project draft", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects/empty", {
    data: { title: "Анализ и Canvas", client_project_id: randomUUID() }
  });
  expect(created.ok()).toBe(true);
  const id = (await created.json()).project.id;
  const scope = (await (await request.get(`/api/v1/projects/${id}/canvas/scope`)).json())
    .owner_scope;
  const oldKey = `kosmora:canvas:draft:v2:${scope}:${id}:new`;
  await page.goto(`/?project=${id}&surface=files`);
  await page.evaluate(
    ({ key }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          title: "Старый черновик",
          content: "Не потерять",
          format: "markdown",
          baseVersion: 0
        })
      ),
    { key: oldKey }
  );
  const library = page.getByRole("region", { name: "Библиотека проекта", exact: true });
  await library.locator('input[type="file"]').setInputFiles([
    {
      name: "budget.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Проект. Бюджет: 42000 рублей.")
    },
    {
      name: "deadline.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Проект. Срок: 25 октября.")
    }
  ]);
  await expect(library.locator('li[data-upload-state="ready"]')).toHaveCount(2);
  await library.getByRole("button", { name: "Предпросмотр budget.txt", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "budget.txt", exact: true });
  await expect(preview.getByLabel("Текст оригинала", { exact: true })).toContainText("42000");
  await preview.getByLabel("Поиск в предпросмотре").fill("неттакоготекста");
  await expect(preview).toContainText("Совпадений не найдено.");
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(
    library.getByRole("button", { name: "Предпросмотр budget.txt", exact: true })
  ).toBeFocused();
  await library.getByLabel("Вопрос к документам").fill("Проект");
  await library.getByRole("button", { name: "Найти источники", exact: true }).click();
  await expect(
    library.getByRole("button", { name: "Редактировать подборку в Canvas", exact: true })
  ).toBeEnabled();
  let canvasPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === `/api/v1/projects/${id}/canvas`)
      canvasPosts++;
  });
  await library
    .getByRole("button", { name: "Редактировать подборку в Canvas", exact: true })
    .click();
  const modal = page.getByRole("dialog", { name: "Документ в Canvas", exact: true });
  const area = modal.getByLabel("Содержимое", { exact: true });
  await expect(area).toHaveValue(/42000/);
  expect(await area.inputValue()).toContain("25 октября");
  expect(await area.inputValue()).toContain("budget.txt");
  expect(await area.inputValue()).toContain("deadline.txt");
  expect(canvasPosts).toBe(0);
  await area.press("Control+Home");
  await area.press("Control+Shift+ArrowRight");
  await modal.getByRole("button", { name: "Жирный", exact: true }).click();
  await expect(area).toHaveValue(/^\*\*Kosmora/);
  await area.fill((await area.inputValue()) + "\n\nПроверено редактором.");
  await modal.getByRole("button", { name: "Закрыть документ Canvas", exact: true }).click();
  await library
    .getByRole("button", { name: "Редактировать подборку в Canvas", exact: true })
    .click();
  await expect(area).toHaveValue(/Проверено редактором/);
  await modal.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(modal.getByRole("status")).toContainText("Артефакт создан");
  expect(canvasPosts).toBe(1);
  const saved = await (await request.get(`/api/v1/projects/${id}/canvas`)).json();
  expect(saved.items).toHaveLength(1);
  const content = await (
    await request.get(`/api/v1/projects/${id}/canvas/${saved.items[0].id}`)
  ).json();
  expect(content.revision.content).toContain("deadline.txt");
  expect(content.revision.content).toContain("Проверено редактором");
  expect(JSON.parse(await page.evaluate((key) => localStorage.getItem(key)!, oldKey)).content).toBe(
    "Не потерять"
  );
  for (const kind of ["Скачать", "Скачать DOCX", "Скачать PDF"]) {
    const pending = page.waitForEvent("download");
    await modal.getByRole("button", { name: kind, exact: true }).click();
    const download = await pending;
    const bytes = await readFile((await download.path())!);
    if (kind === "Скачать") expect(bytes.toString()).toContain("42000");
    else if (kind === "Скачать DOCX")
      expect(strFromU8(unzipSync(bytes)["word/document.xml"]!)).toContain("deadline.txt");
    else expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  }
  await modal.getByRole("button", { name: "Закрыть документ Canvas", exact: true }).click();
  await page.reload();
  await library.getByLabel("Вопрос к документам").fill("Проект");
  await library.getByRole("button", { name: "Найти источники", exact: true }).click();
  await library
    .getByRole("button", { name: "Редактировать подборку в Canvas", exact: true })
    .click();
  await expect(area).toHaveValue(/Проверено редактором/);
  expect(canvasPosts).toBe(1);
  await page.screenshot({ path: "../../qa/files-canvas-workflow.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const box = await modal.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "../../qa/files-canvas-workflow-mobile.png", fullPage: true });
});

test("saved model answer opens with its evidence snapshot; no model call on editing", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects/empty", {
    data: { title: "Ответ с источниками", client_project_id: randomUUID() }
  });
  const id = (await created.json()).project.id;
  const answer = {
    id: randomUUID(),
    question: "Какой бюджет?",
    answer: "Бюджет 42000 [S1].",
    status: "done",
    error_code: null,
    citations: ["S1"],
    sources: [
      {
        ref: "S1",
        name: "budget.txt",
        page: null,
        line_start: 1,
        line_end: 2,
        content: "Бюджет: 42000 рублей."
      }
    ]
  };
  let modelPosts = 0;
  await page.route(`**/projects/${id}/document-library/answers`, (route) => {
    if (route.request().method() === "POST") modelPosts++;
    return route.fulfill({ json: { answers: [answer], available: true } });
  });
  await page.goto(`/?project=${id}&surface=files`);
  await page.getByRole("button", { name: "Редактировать в Canvas", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Документ в Canvas", exact: true });
  await expect(modal.getByLabel("Содержимое", { exact: true })).toHaveValue(
    /\[S1\] budget.txt, строки 1–2/
  );
  await modal
    .getByLabel("Содержимое", { exact: true })
    .fill("Редакция ответа. [S1]\nИсточник: budget.txt, строки 1–2.");
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await page.reload();
  await page.getByRole("button", { name: "Редактировать в Canvas", exact: true }).click();
  await expect(modal.getByLabel("Содержимое", { exact: true })).toHaveValue(/^Редакция ответа/);
  expect(modelPosts).toBe(0);
});

test("photo preview prepares an image attachment without sending a message", async ({ page }) => {
  let posts = 0;
  page.on("request", (r) => {
    if (
      r.method() === "POST" &&
      new URL(r.url()).pathname !== "/api/v1/chat-navigation/import-pins"
    )
      posts++;
  });
  await page.goto("/?surface=files");
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 32;
    c.height = 32;
    c.getContext("2d")!.fillRect(0, 0, 32, 32);
    return c.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByLabel("Крупный документ").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64")
  });
  await expect(page.getByRole("img", { name: "Предпросмотр photo.png" })).toBeVisible();
  await page.getByLabel("Вопрос к изображению").fill("Что на фото?");
  await page.getByRole("button", { name: "Подготовить анализ в чате", exact: true }).click();
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue("Что на фото?");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("photo.png");
  expect(posts).toBe(0);
});
