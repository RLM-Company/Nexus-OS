import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const chatId = "a1090011-0001-4000-8000-000000000001";
const projectId = "a1090011-0001-4000-8000-000000000002";
const at = "2026-10-11T10:00:00.000Z";
const title = "Обсуждение экспорта";
const code = "```ts\nexport const answer = 42;\n```\n\nГотово 🪐";
const messages = [
  {
    id: `${chatId}-1`,
    chat_id: chatId,
    role: "user",
    content_type: "text",
    content: "Прочитай файл",
    attachments: [{ name: "план.txt", content: "attachment body must not leak" }],
    status: "completed",
    run_id: null,
    error_code: null,
    created_at: at,
    updated_at: at
  },
  {
    id: `${chatId}-2`,
    chat_id: chatId,
    role: "assistant",
    content_type: "text",
    content: code,
    attachments: [],
    status: "completed",
    run_id: null,
    error_code: null,
    created_at: at,
    updated_at: at
  }
];

async function fixture(page: Page, project = false) {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (["POST", "PATCH", "PUT", "DELETE"].includes(request.method())) writes.push(request.url());
  });
  await page.route("**/api/v1/chats", (route) =>
    route.fulfill({
      json: {
        items: project
          ? []
          : [
              {
                id: chatId,
                title,
                created_at: at,
                updated_at: at,
                last_message_preview: "Прочитай файл"
              }
            ]
      }
    })
  );
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({
      json: {
        items: project
          ? [
              {
                id: projectId,
                title,
                status: "ACTIVE",
                created_at: at,
                updated_at: at,
                last_message_preview: "Прочитай файл"
              }
            ]
          : []
      }
    })
  );
  if (project) {
    await page.route(`**/api/v1/projects/${projectId}`, (route) =>
      route.fulfill({
        json: {
          project: { id: projectId, title, status: "ACTIVE", created_at: at, updated_at: at },
          chat_id: chatId,
          messages: [
            ...messages.map((message) => ({
              ...message,
              project_id: projectId,
              reply_to_message_id: null
            })),
            {
              ...messages[0],
              id: "event",
              role: "system_event",
              content: "Internal event",
              attachments: []
            }
          ]
        }
      })
    );
  } else {
    await page.route(`**/api/v1/chats/${chatId}`, (route) =>
      route.fulfill({
        json: {
          chat: { id: chatId, title, created_at: at, updated_at: at },
          messages
        }
      })
    );
  }
  await page.goto(project ? `/?project=${projectId}` : `/?chat=${chatId}`);
  await expect(page.locator(".topbar h1")).toHaveText(title);
  await page
    .getByLabel(project ? "Сообщение менеджеру" : "Сообщение Kosmora", { exact: true })
    .fill("Неотправленный черновик");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  return writes;
}

test("downloads both formats locally with code, dates, metadata and no drafts or writes", async ({
  page
}) => {
  const writes = await fixture(page);
  const downloadMd = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать переписку", exact: true }).click();
  const md = await downloadMd;
  expect(md.suggestedFilename()).toMatch(/^kosmora-Обсуждение-экспорта-\d+\.md$/);
  const markdown = await readFile((await md.path())!, "utf8");
  expect(markdown).toContain(code);
  expect(markdown).toContain(at);
  expect(markdown).toContain("план\\.txt");
  expect(markdown).not.toMatch(/attachment body|Неотправленный черновик/);
  await page.getByLabel("Формат файла", { exact: true }).selectOption("json");
  const downloadJson = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать переписку", exact: true }).click();
  const json = await downloadJson;
  const parsed = JSON.parse(await readFile((await json.path())!, "utf8"));
  expect(parsed.conversation).toEqual({ id: chatId, project_id: null, title });
  expect(parsed.messages).toHaveLength(2);
  expect(parsed.messages[1].content).toBe(code);
  expect(parsed.messages[0].attachments[0]).toEqual({
    name: "план.txt",
    kind: "document",
    source_type: "text"
  });
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(
    "Неотправленный черновик"
  );
  expect(writes).toEqual([]);
});

test("exports a project chat on mobile without exposing system events", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const writes = await fixture(page, true);
  await page.getByLabel("Формат файла", { exact: true }).selectOption("json");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать переписку", exact: true }).click();
  const file = await downloaded;
  const result = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(result.conversation).toEqual({ id: chatId, project_id: projectId, title });
  expect(result.messages).toHaveLength(2);
  expect(JSON.stringify(result)).not.toContain("Internal event");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "../../qa/kosmora-chat-export-mobile.png" });
  expect(writes).toEqual([]);
});

test("an empty chat cannot download a fabricated transcript", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Скачать переписку", exact: true })).toBeDisabled();
});
