import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

test.setTimeout(60000);
async function project(request: APIRequestContext) {
  const result = await request.post("/api/v1/projects", {
    data: { initial_message: "Game acceptance fixture", client_message_id: randomUUID() }
  });
  expect(result.ok()).toBe(true);
  const id = ((await result.json()) as { project: { id: string } }).project.id;
  expect(
    (
      await request.put(`/api/v1/projects/${id}/autonomy-profile`, {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).ok()
  ).toBe(true);
  return id;
}
async function create(page: Page, request: APIRequestContext, genre: "arcade" | "memory" | "quiz") {
  const id = await project(request);
  await page.goto(`/?surface=games&project=${id}`);
  await page.getByRole("combobox", { name: "Проект игры", exact: true }).selectOption(id);
  await page.getByRole("combobox", { name: "Механика игры", exact: true }).selectOption(genre);
  await page
    .getByRole("textbox", { name: "Что создаём?", exact: true })
    .fill(`E2E_GAME_WORK_${genre}: космическая тема`);
  await page.getByRole("button", { name: "Создать игру", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Прототип готов" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть игру в редакторе", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  await expect(canvas.getByRole("textbox", { name: "Содержимое", exact: true })).toBeEnabled();
  return { id, canvas, frame: page.frameLocator('iframe[title="Игра Kosmora"]') };
}

test("generates a quiz, saves versions and exports a playable offline HTML file", async ({
  page,
  request,
  browser
}, testInfo) => {
  const { id, canvas, frame } = await create(page, request, "quiz");
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const source = canvas.getByRole("textbox", { name: "Содержимое", exact: true });
  const edited = (await source.inputValue()).replace("Космическая викторина", "Викторина Kosmora");
  await source.fill(edited);
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  await canvas.getByRole("button", { name: "Играть", exact: true }).click();
  await expect(
    frame.getByRole("heading", { name: "Викторина Kosmora", exact: true })
  ).toBeVisible();
  for (const answer of ["4", "7", "Луна"]) {
    await frame.getByRole("button", { name: answer, exact: true }).click();
    await frame.getByRole("button", { name: "Дальше", exact: true }).click();
  }
  await expect(frame.locator("#status")).toHaveText("Викторина завершена: 3 / 3");
  const jsonDownload = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать", exact: true }).click();
  const jsonFile = await jsonDownload;
  expect(jsonFile.suggestedFilename()).toMatch(/\.json$/);
  expect(await readFile(await jsonFile.path(), "utf8")).toBe(edited);
  const downloaded = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать игру HTML", exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.html$/);
  expect(await readFile(await file.path(), "utf8")).toContain("Викторина Kosmora");
  const offline = await browser.newContext({ offline: true });
  try {
    const local = await offline.newPage();
    const htmlPath = testInfo.outputPath("game.html");
    await file.saveAs(htmlPath);
    await local.goto(pathToFileURL(htmlPath).href);
    await local.getByRole("button", { name: "Начать", exact: true }).click();
    await local.getByRole("button", { name: "4", exact: true }).click();
    await expect(local.locator("#score")).toHaveText("Верных ответов: 1 / 3");
  } finally {
    await offline.close();
  }
  await page.reload();
  await page.getByRole("combobox", { name: "Проект игры", exact: true }).selectOption(id);
  await canvas
    .getByRole("navigation", { name: "Артефакты проекта" })
    .getByRole("button", { name: /Космическая викторина.*v2/ })
    .click();
  await expect(source).toHaveValue(edited);
});

test("memory prototype finds all pairs and restarts cleanly", async ({ page, request }) => {
  const { canvas, frame } = await create(page, request, "memory");
  await canvas.getByRole("button", { name: "Играть", exact: true }).click();
  const cards = frame.locator("#cards button");
  await expect(cards).toHaveCount(8);
  const known = new Map<string, number[]>();
  for (let i = 0; i < 8; i += 2) {
    await cards.nth(i).click();
    const a = await cards.nth(i).innerText();
    await cards.nth(i + 1).click();
    const b = await cards.nth(i + 1).innerText();
    for (const [label, position] of [
      [a, i],
      [b, i + 1]
    ] as const)
      known.set(label, [...(known.get(label) ?? []), position]);
    if (a !== b) await expect(cards.nth(i)).toHaveText("?");
  }
  for (const positions of known.values()) {
    if (await cards.nth(positions[0]!).isDisabled()) continue;
    await cards.nth(positions[0]!).click();
    await cards.nth(positions[1]!).click();
  }
  await expect(frame.locator("#status")).toHaveText("Все пары найдены!");
  await frame.getByRole("button", { name: "Заново", exact: true }).click();
  await expect(frame.locator("#score")).toHaveText("Найдено пар: 0 / 4");
  await expect(cards.filter({ hasText: "?" })).toHaveCount(8);
});

test("arcade supports keyboard control, a real pause and stopping the prototype", async ({
  page,
  request
}) => {
  const { canvas, frame } = await create(page, request, "arcade");
  await canvas.getByRole("button", { name: "Играть", exact: true }).click();
  const stage = frame.locator("canvas");
  await expect(stage).toBeVisible();
  const pixel = () =>
    stage.evaluate(
      (element: HTMLCanvasElement) => element.getContext("2d")!.getImageData(320, 330, 1, 1).data[0]
    );
  expect(await pixel()).toBeLessThan(50);
  await stage.focus();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  expect(await pixel()).toBeGreaterThan(200);
  await frame.getByRole("button", { name: "Пауза", exact: true }).click();
  await expect(frame.locator("#status")).toHaveText("Пауза");
  const remaining = await frame.locator("#time").innerText();
  await page.waitForTimeout(1100);
  await expect(frame.locator("#time")).toHaveText(remaining);
  await frame.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(frame.locator("#status")).toHaveText("Игра идёт");
  await canvas.getByRole("button", { name: "Остановить прототип", exact: true }).click();
  await expect(page.locator('iframe[title="Игра Kosmora"]')).toHaveCount(0);
});

test("game labels stay literal data and malformed edits stop the running engine", async ({
  page,
  request
}) => {
  const { canvas, frame } = await create(page, request, "memory");
  const source = canvas.getByRole("textbox", { name: "Содержимое", exact: true });
  const data = JSON.parse(await source.inputValue()) as { title: string };
  const hostile =
    '</script><img src="https://blocked-game.invalid/pixel" onerror="parent.document.body.remove()">';
  data.title = hostile.slice(0, 100);
  const traffic: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("blocked-game.invalid")) traffic.push(req.url());
  });
  await source.fill(JSON.stringify(data));
  await canvas.getByRole("button", { name: "Играть", exact: true }).click();
  await expect(frame.getByRole("heading", { name: data.title, exact: true })).toBeVisible();
  await expect(frame.locator("img")).toHaveCount(0);
  expect(
    await frame.locator("body").evaluate(() => {
      try {
        void parent.document.body;
        return "accessible";
      } catch {
        return "blocked";
      }
    })
  ).toBe("blocked");
  await source.fill('{"format":"broken"}');
  await expect(page.locator('iframe[title="Игра Kosmora"]')).toHaveCount(0);
  await expect(canvas.getByRole("button", { name: "Играть", exact: true })).toBeDisabled();
  expect(traffic).toEqual([]);
});
