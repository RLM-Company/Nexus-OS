import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const input = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../../docs/handoff/fixtures/kosmora-composer/input.json"),
    "utf8"
  )
) as { text: string; file: { name: string; mimeType: string; content: string } };
const label = "Сообщение Kosmora";
const key = "cosmora:composer-draft:new-chat";
const raw = input.text;
const latest = "Последнее изменение: 19 700 ₽; 00123; кроме доставки";
const fixture = {
  name: input.file.name,
  mimeType: input.file.mimeType,
  buffer: Buffer.from(input.file.content, "utf8")
};

test("pagehide persists the last input before React commits its passive effects", async ({
  page
}) => {
  await page.goto("/");
  const editor = page.getByLabel(label);
  await editor.fill("Предыдущий текст");
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), key))
    .toBe("Предыдущий текст");
  const stored = await editor.evaluate((field, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      value
    );
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })
    );
    window.dispatchEvent(new Event("pagehide"));
    return localStorage.getItem("cosmora:composer-draft:new-chat");
  }, latest);
  expect(stored).toBe(latest);
  await page.reload();
  await expect(page.getByLabel(label)).toHaveValue(latest);
});

test("pagehide persists removal of a file without resurrecting the old attachment", async ({
  page
}) => {
  await page.goto("/");
  await page.getByLabel(label).fill(raw);
  await page.getByLabel("Текстовые файлы и код").setInputFiles(fixture);
  const remove = page.getByRole("button", { name: "Удалить brief.txt" });
  await expect(remove).toBeEnabled();
  const count = await remove.evaluate((button) => {
    (button as HTMLButtonElement).click();
    window.dispatchEvent(new Event("pagehide"));
    return (
      JSON.parse(localStorage.getItem("cosmora:composer-materials:new-chat") ?? '{"files":[]}') as {
        files: unknown[];
      }
    ).files.length;
  });
  expect(count).toBe(0);
  await page.reload();
  await expect(page.getByLabel(label)).toHaveValue(raw);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("native text-only pagehide flush uses the latest input rather than an older render", async ({
  page
}) => {
  await page.addInitScript(() => {
    const proof: Array<{ scope: string; text: string }> = [];
    Object.assign(window, {
      draftFlushProof: proof,
      kosmoraDesktopDraft: {
        load: async () => ({ ok: true, text: "" }),
        save: async () => ({ ok: true }),
        clear: async () => ({ ok: true }),
        flush: (scope: string, text: string) => proof.push({ scope, text })
      }
    });
  });
  await page.goto("/");
  const editor = page.getByLabel(label);
  await editor.fill("Предыдущий текст");
  const snapshot = await editor.evaluate((field, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      field,
      value
    );
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: value })
    );
    window.dispatchEvent(new Event("pagehide"));
    return (
      window as unknown as { draftFlushProof: Array<{ scope: string; text: string }> }
    ).draftFlushProof.at(-1);
  }, latest);
  expect(snapshot).toEqual({ scope: "new-chat", text: latest });
  expect(
    await page.evaluate(() => localStorage.getItem("cosmora:composer-draft:new-chat"))
  ).toBeNull();
});

for (const kind of ["chat", "project"] as const)
  test(`${kind} rejection preserves exact whitespace and file bytes across reload`, async ({
    page,
    request
  }) => {
    let projectId: string | null = null;
    if (kind === "project") {
      const response = await request.post("/api/v1/projects", {
        data: {
          initial_message: "Проект для проверки черновика",
          client_message_id: crypto.randomUUID()
        }
      });
      projectId = ((await response.json()) as { project: { id: string } }).project.id;
    }
    await page.goto(projectId ? `/?project=${projectId}` : "/");
    const editorLabel = projectId ? "Сообщение менеджеру" : label;
    await page.getByLabel(editorLabel).fill(raw);
    await page.getByLabel("Текстовые файлы и код").setInputFiles(fixture);
    await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
      fixture.name
    );
    await page.route(
      projectId ? `**/api/v1/projects/${projectId}/messages` : "**/api/v1/chats",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const body = route.request().postDataJSON() as {
          content?: string;
          initial_message?: string;
        };
        expect(projectId ? body.content : body.initial_message).toBe(raw.trim());
        await route.fulfill({ status: 503, json: { error: { message: "Fixture rejected" } } });
      }
    );
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    await expect(page.getByLabel(editorLabel)).toBeEnabled();
    await expect(page.getByLabel(editorLabel)).toHaveValue(raw);
    await page.reload();
    await expect(page.getByLabel(editorLabel)).toHaveValue(raw);
    const storageKey = projectId
      ? `cosmora:composer-materials:project:${projectId}`
      : "cosmora:composer-materials:new-chat";
    const saved = (await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      storageKey
    )) as { files: Array<{ name: string; content: string }> };
    expect(saved.files).toEqual([{ name: fixture.name, content: fixture.buffer.toString("utf8") }]);
    if (kind === "chat") {
      const stored = await page.evaluate(() => ({
        text: localStorage.getItem("cosmora:composer-draft:new-chat"),
        materials: localStorage.getItem("cosmora:composer-materials:new-chat")
      }));
      const artifact = test.info().outputPath("browser-draft-readback.json");
      writeFileSync(
        artifact,
        JSON.stringify(
          {
            scenario: "rejected-submit-reload",
            source: "docs/handoff/fixtures/kosmora-composer/input.json",
            scope: "new-chat",
            model_called: false,
            text: stored.text,
            materials: JSON.parse(stored.materials!),
            text_sha256: createHash("sha256").update(stored.text!).digest("hex"),
            file_sha256: createHash("sha256").update(saved.files[0]!.content).digest("hex")
          },
          null,
          2
        )
      );
      await test
        .info()
        .attach("browser-draft-readback", { path: artifact, contentType: "application/json" });
    }
  });

test("closing an unchanged tab does not overwrite another tab's newer draft", async ({
  page,
  context
}) => {
  await page.goto("/");
  await page.getByLabel(label).fill("Начальный текст");
  const idle = await context.newPage();
  await idle.goto("/");
  await expect(idle.getByLabel(label)).toHaveValue("Начальный текст");
  await page.getByLabel(label).fill(latest);
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), key)).toBe(latest);
  await idle.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(latest);
  await idle.close();
});

test("a file finishing after chat navigation cannot leak or replace the next chat's draft", async ({
  page,
  request
}) => {
  const ids: string[] = [];
  for (const initial_message of ["Чат A для границы черновиков", "Чат B для границы черновиков"]) {
    const response = await request.post("/api/v1/chats", {
      data: { initial_message, client_message_id: crypto.randomUUID() }
    });
    ids.push(((await response.json()) as { chat: { id: string } }).chat.id);
  }
  await page.goto(`/?chat=${ids[0]}`);
  await page.getByLabel(label).fill("Текст чата A");
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "deferred.txt") return read.call(this);
      const file = this;
      return new Promise<ArrayBuffer>((resolve) => {
        Object.assign(window, { releaseDraftFile: async () => resolve(await read.call(file)) });
      });
    };
  });
  await page
    .getByLabel("Текстовые файлы и код")
    .setInputFiles({ ...fixture, name: "deferred.txt" });
  await expect(page.locator(".chat-attachment-picker").getByRole("status")).toContainText(
    "Читаю файлы"
  );
  await page
    .locator(".sidebar")
    .locator(".chat-item")
    .filter({ hasText: "Чат B для границы черновиков" })
    .click();
  await page.getByLabel(label).fill("Текст чата B");
  await page.evaluate(async () => {
    await (window as unknown as { releaseDraftFile: () => Promise<void> }).releaseDraftFile();
  });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await expect(page.getByLabel(label)).toHaveValue("Текст чата B");
  await page.reload();
  await expect(page.getByLabel(label)).toHaveValue("Текст чата B");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await page.goto(`/?chat=${ids[0]}`);
  await expect(page.getByLabel(label)).toHaveValue("Текст чата A");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("a follow-up inserted just before pagehide survives without an automatic send", async ({
  page,
  request
}) => {
  const response = await request.post("/api/v1/chats", {
    data: { initial_message: "Чат для вставки продолжения", client_message_id: crypto.randomUUID() }
  });
  const id = ((await response.json()) as { chat: { id: string } }).chat.id;
  await page.goto(`/?chat=${id}`);
  await page.getByLabel(label).fill("Мой текст");
  const follow = page
    .locator(".message.assistant")
    .getByRole("button", { name: "Объяснить проще", exact: true });
  await expect(follow).toBeEnabled();
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/v1\/chats(?:\/[^/]+\/messages)?$/.test(request.url())
    )
      posts++;
  });
  const stored = await follow.evaluate((button, id) => {
    (button as HTMLButtonElement).click();
    window.dispatchEvent(new Event("pagehide"));
    return localStorage.getItem(`cosmora:composer-draft:chat:${id}`);
  }, id);
  const expected = "Мой текст\n\nОбъясни предыдущий ответ проще и приведи пример.";
  expect(stored).toBe(expected);
  await page.reload();
  await expect(page.getByLabel(label)).toHaveValue(expected);
  expect(posts).toBe(0);
});

test("an input notification already tracked before React change survives attaching a file", async ({
  page
}) => {
  await page.goto("/");
  const editor = page.getByLabel(label);
  await expect(editor).toBeEnabled();
  await editor.evaluate((field, text) => {
    // Assisted input can update the DOM's tracked value before notifying the app.
    (field as HTMLTextAreaElement).value = text;
    field.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertText", data: text })
    );
  }, raw);
  await page.getByLabel("Текстовые файлы и код").setInputFiles(fixture);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(fixture.name);
  await expect(editor).toHaveValue(raw);
  expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(raw);
});

async function namedDraft(
  page: import("@playwright/test").Page,
  request: import("@playwright/test").APIRequestContext
) {
  const response = await request.post("/api/v1/chats", {
    data: {
      initial_message: "История для проверки поздней квитанции",
      client_message_id: crypto.randomUUID()
    }
  });
  const id = ((await response.json()) as { chat: { id: string } }).chat.id;
  await page.goto(`/?chat=${id}`);
  await page.getByLabel(label).fill(raw);
  return id;
}
async function holdSubmission(page: import("@playwright/test").Page, id: string, rejected = false) {
  let release!: () => void, started!: (stream: string | null) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<string | null>((resolve) => {
    started = resolve;
  });
  await page.route(`**/api/v1/chats/${id}/messages`, async (route) => {
    const response = rejected ? null : await route.fetch();
    started(response ? ((await response.json()) as { stream_url: string }).stream_url : null);
    await gate;
    if (response) await route.fulfill({ response });
    else await route.fulfill({ status: 503, json: { error: { message: "Fixture rejected" } } });
  });
  return { release, received };
}
for (const rejected of [false, true])
  test(`a late ${rejected ? "rejection" : "acceptance"} cannot erase a newer prepared follow-up`, async ({
    page,
    request
  }) => {
    const id = await namedDraft(page, request);
    await page.getByLabel("Текстовые файлы и код").setInputFiles(fixture);
    await page.getByRole("button", { name: "Действие с текстом", exact: true }).click();
    await page.getByRole("menuitem", { name: "Объяснить тему", exact: true }).click();
    const held = await holdSubmission(page, id, rejected);
    const sent = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        new URL(request.url()).pathname === `/api/v1/chats/${id}/messages`
    );
    await page.getByRole("button", { name: "Отправить", exact: true }).click();
    const payload = (await sent).postDataJSON() as {
      text_action: { kind: string };
      attachments: { name: string; content: string }[];
    };
    expect(payload.text_action).toEqual({ kind: "explain" });
    expect(payload.attachments).toEqual([
      expect.objectContaining({ name: fixture.name, content: fixture.buffer.toString("utf8") })
    ]);
    const stream = await held.received;
    const followed = stream
      ? page.waitForRequest(
          (r) => new URL(r.url()).pathname === new URL(stream, page.url()).pathname
        )
      : null;
    const expected = raw + "\n\nОбъясни предыдущий ответ проще и приведи пример.";
    try {
      await page
        .locator(".message.assistant")
        .first()
        .getByRole("button", { name: "Объяснить проще", exact: true })
        .click();
      await expect(page.getByLabel(label)).toHaveValue(expected);
    } finally {
      held.release();
    }
    if (rejected)
      await expect(
        page.locator(".composer").getByText(/результат запроса неизвестен/)
      ).toBeVisible();
    else await followed;
    await expect(page.getByRole("button", { name: "Объяснить тему", exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
      fixture.name
    );
    await page.reload();
    await expect(page.getByLabel(label)).toHaveValue(expected);
  });
test("an acceptance cannot clear another tab's newer stored draft", async ({
  page,
  request,
  context
}) => {
  const id = await namedDraft(page, request);
  const held = await holdSubmission(page, id);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const stream = await held.received;
  const followed = page.waitForRequest(
    (r) => new URL(r.url()).pathname === new URL(stream!, page.url()).pathname
  );
  const other = await context.newPage();
  try {
    await other.goto(`/?chat=${id}`);
    await other.getByLabel(label).fill(latest);
    await expect
      .poll(() =>
        other.evaluate((key) => localStorage.getItem(key), `cosmora:composer-draft:chat:${id}`)
      )
      .toBe(latest);
  } finally {
    held.release();
  }
  await followed;
  await page.reload();
  await expect(page.getByLabel(label)).toHaveValue(latest);
  await other.close();
});
