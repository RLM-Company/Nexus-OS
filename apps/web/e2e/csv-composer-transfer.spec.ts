import { expect, test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const input = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../docs/handoff/fixtures/kosmora-csv-transfer/input.json"),
    "utf8"
  )
) as { csv: string; expected_selection: string; question: string };
const label = "Сообщение Kosmora";
async function selectCsv(page: Page) {
  await page.goto("/?surface=files");
  await page
    .getByLabel("Крупный документ")
    .setInputFiles({ name: "offer.csv", mimeType: "text/csv", buffer: Buffer.from(input.csv) });
  await page.getByLabel("Поиск / фильтр по выбранным столбцам").fill("00123");
  await expect(page.getByRole("status")).toHaveText("После фильтра: 1 из 2 записей");
  await page.getByLabel("Что разобрать?").fill(input.question);
}
function countPosts(page: Page) {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/v1\/(?:chats(?:\/[^/]+\/messages)?|projects(?:\/[^/]+\/(?:messages|work))?)$/.test(
        new URL(request.url()).pathname
      )
    )
      posts.push(new URL(request.url()).pathname);
  });
  return posts;
}
async function nativeFixture(page: Page) {
  await page.addInitScript(() => {
    let reads = 0;
    let release: (() => void) | undefined;
    Object.assign(window, {
      csvTransferFixture: { reads: () => reads, release: () => release?.() },
      kosmoraDesktopDraft: {
        load: () => {
          reads++;
          return reads === 2
            ? new Promise((resolve) => {
                release = () => resolve({ ok: true, text: "" });
              })
            : Promise.resolve({ ok: true, text: "" });
        },
        save: () => Promise.resolve({ ok: true }),
        clear: () => Promise.resolve({ ok: true }),
        flush() {}
      }
    });
  });
}
async function reads(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as { csvTransferFixture: { reads: () => number } }
    ).csvTransferFixture.reads()
  );
}
async function release(page: Page) {
  await page.evaluate(() =>
    (
      window as unknown as { csvTransferFixture: { release: () => void } }
    ).csvTransferFixture.release()
  );
}

test("web CSV transfer preserves exact selected bytes and text through reload without dispatch", async ({
  page
}) => {
  const posts = countPosts(page);
  await selectCsv(page);
  await page.getByRole("button", { name: "Подготовить выборку в чате" }).click();
  const editor = page.getByLabel(label);
  await expect(editor).toHaveValue(/1 из 1 строк текущего фильтра/);
  const prompt = await editor.inputValue();
  expect(prompt).toContain(input.question);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("cosmora:composer-materials:new-chat")))
    .not.toBeNull();
  const stored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("cosmora:composer-materials:new-chat")!) as {
        files: Array<{ name: string; content: string }>;
      }
  );
  expect(stored.files).toEqual([{ name: "csv-selection.csv", content: input.expected_selection }]);
  await page.reload();
  await expect(page.getByLabel(label)).toHaveValue(prompt);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "csv-selection.csv"
  );
  const restored = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("cosmora:composer-materials:new-chat")!) as {
        files: Array<{ name: string; content: string }>;
      }
  );
  expect(restored.files).toEqual(stored.files);
  expect(posts).toEqual([]);
  const csvPath = test.info().outputPath("csv-selection.csv");
  writeFileSync(csvPath, restored.files[0]!.content);
  await test.info().attach("actual restored CSV bytes", { path: csvPath, contentType: "text/csv" });
  const report = {
    real_model_called: false,
    browser_model_posts: posts,
    prompt,
    selected_csv: stored.files[0]!.content,
    selected_sha256: createHash("sha256").update(stored.files[0]!.content).digest("hex"),
    source_sha256: createHash("sha256").update(input.csv).digest("hex"),
    reload_verified: true
  };
  const path = test.info().outputPath("csv-transfer-result.json");
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  await test
    .info()
    .attach("actual CSV transfer readback", { path, contentType: "application/json" });
  if (process.env.KOSMORA_CSV_REPORT_DIR) {
    mkdirSync(process.env.KOSMORA_CSV_REPORT_DIR, { recursive: true });
    writeFileSync(
      resolve(process.env.KOSMORA_CSV_REPORT_DIR, "result.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" }
    );
  }
});

test("CSV transfer waits for delayed native draft hydration in its target scope", async ({
  page
}) => {
  await nativeFixture(page);
  const posts = countPosts(page);
  await selectCsv(page);
  await page.getByRole("button", { name: "Подготовить выборку в чате" }).click();
  await expect.poll(() => reads(page)).toBe(2);
  await expect(page.getByLabel(label)).toBeDisabled();
  await release(page);
  await expect(page.getByLabel(label)).toBeEnabled();
  await expect(page.getByLabel(label)).toHaveValue(/1 из 1 строк текущего фильтра/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "csv-selection.csv"
  );
  expect(posts).toEqual([]);
});

test("a second new chat cancels a pending CSV transfer before native hydration settles", async ({
  page
}) => {
  await nativeFixture(page);
  const posts = countPosts(page);
  await selectCsv(page);
  await page.getByRole("button", { name: "Подготовить выборку в чате" }).click();
  await expect.poll(() => reads(page)).toBe(2);
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect.poll(() => reads(page)).toBe(3);
  await expect(page.getByLabel(label)).toBeEnabled();
  await release(page);
  await expect(page.getByLabel(label)).toHaveValue("");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  expect(posts).toEqual([]);
});
