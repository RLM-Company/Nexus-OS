import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

import { writeFileSync } from "node:fs";

async function receipt(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  await info.attach(name, { contentType: "application/json", path });
}

const source = "Реквизиты: 19 700 ₽; артикул 00123; 13.11.2026; кроме доставки";
const sourceFile = { name: "original.txt", content: "Не включать доставку: 00123; 19 700" };
const restoreLabel = "Вернуть запрос в редактор";

async function fixture(
  page: Page,
  request: APIRequestContext,
  kind: "chat" | "project",
  phase: "failed" | "cancelled",
  assistantExists = false
) {
  const root = kind === "chat" ? "/api/v1/chats" : "/api/v1/projects";
  const created = await request.post(root, {
    data: {
      initial_message: source,
      attachments: [sourceFile],
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const accepted = (await created.json()) as {
    chat?: { id: string };
    project?: { id: string };
    run_id: string;
  };
  const id = (kind === "chat" ? accepted.chat : accepted.project)!.id;
  const detailPath = `${root}/${id}`;
  const response = await request.get(detailPath);
  expect(response.ok()).toBe(true);
  const history = (await response.json()) as {
    messages: Array<{ id: string; role: string; content: string; status: string }>;
  };
  history.messages = history.messages.filter((message) => message.role === "user");
  expect(history.messages).toHaveLength(1);
  if (assistantExists) {
    history.messages.push({
      ...history.messages[0]!,
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      status: phase
    });
  }
  await page.route(`**${detailPath}`, (route) => route.fulfill({ json: history }));
  const streamPath = kind === "chat" ? "chat-runs" : "runs";
  await page.route(`**/api/v1/${streamPath}/${accepted.run_id}/events`, (route) => {
    const type = `run.${phase}`;
    return route.fulfill({
      contentType: "text/event-stream",
      body: `event: ${type}\ndata: ${JSON.stringify({
        type,
        data: { run_id: accepted.run_id, error_code: "INTERRUPTED" }
      })}\n\n`
    });
  });
  await page.goto(`/?${kind}=${id}`);
  const editor = page.getByLabel(kind === "chat" ? "Сообщение Kosmora" : "Сообщение менеджеру");
  await expect(editor).toBeEnabled();
  await expect(page.locator(".live-badge")).toHaveText(
    phase === "failed" ? /Ошибка/ : /Остановлен/
  );
  return { editor, id };
}

for (const kind of ["chat", "project"] as const) {
  for (const phase of ["failed", "cancelled"] as const) {
    test(`${kind}: restores a ${phase} request before any assistant, persists exact materials and sends nothing`, async ({
      page,
      request
    }, info) => {
      const { editor, id } = await fixture(page, request, kind, phase);
      const posts: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST") posts.push(new URL(request.url()).pathname);
      });
      await page.getByRole("button", { name: restoreLabel }).click();
      await expect(editor).toHaveValue(source);
      await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
        sourceFile.name
      );
      const materialKey = `cosmora:composer-materials:${kind}:${id}`;
      await expect
        .poll(() => page.evaluate((key) => localStorage.getItem(key), materialKey))
        .not.toBeNull();
      const saved = (await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!),
        materialKey
      )) as { files: (typeof sourceFile)[] };
      expect(saved.files).toEqual([sourceFile]);
      await page.reload();
      await expect(editor).toHaveValue(source);
      await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
        sourceFile.name
      );
      const executionPosts = posts.filter((path) =>
        /^\/api\/v1\/(chats|projects|chat-runs|runs)(\/|$)/.test(path)
      );
      await receipt(info, "restored-request-readback", {
        kind,
        phase,
        text: await editor.inputValue(),
        files: saved.files,
        all_posts: posts,
        execution_posts: executionPosts,
        real_model_called: false
      });
      expect(executionPosts).toEqual([]);
    });
  }
  for (const draft of ["file", "whitespace"] as const) {
    test(`${kind}: an existing ${draft} draft is protected from request recovery`, async ({
      page,
      request
    }) => {
      const { editor } = await fixture(page, request, kind, "failed", true);
      await expect(page.getByRole("button", { name: restoreLabel })).toBeVisible();
      if (draft === "file") {
        await page.getByLabel("Текстовые файлы и код").setInputFiles({
          name: "new.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Новый выбранный файл 00123")
        });
        await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
          "new.txt"
        );
      } else {
        await editor.fill(" \n\t ");
      }
      await expect(page.getByRole("button", { name: restoreLabel })).toHaveCount(0);
      await page.reload();
      await expect(editor).toHaveValue(draft === "whitespace" ? " \n\t " : "");
      if (draft === "file") {
        await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
          "new.txt"
        );
        await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).not.toContainText(
          "original.txt"
        );
      }
    });
  }
  test(`${kind}: a stale recovery click cannot replace newer input in the same browser turn`, async ({
    page,
    request
  }) => {
    const { editor } = await fixture(page, request, kind, "failed", true);
    await page.getByRole("button", { name: restoreLabel }).evaluate((button) => {
      const field = document.querySelector<HTMLTextAreaElement>("#task")!;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        field,
        "Новый текст 00123"
      );
      field.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "Новый текст 00123"
        })
      );
      (button as HTMLButtonElement).click();
    });
    await expect(editor).toHaveValue("Новый текст 00123");
    await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  });
  test(`${kind}: recovery cannot discard a file that is still being read`, async ({
    page,
    request
  }, info) => {
    const { editor, id } = await fixture(page, request, kind, "failed", true);
    await page.evaluate(() => {
      const read = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = function () {
        if (this.name !== "pending.txt") return read.call(this);
        const file = this;
        return new Promise<ArrayBuffer>((resolve) => {
          Object.assign(window, {
            releaseRecoveryRead: async () => resolve(await read.call(file))
          });
        });
      };
    });
    await page.getByLabel("Текстовые файлы и код").setInputFiles({
      name: "pending.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Новый ожидающий файл 00123")
    });
    const clip = page.getByRole("button", { name: "Прикрепить файл", exact: true });
    await expect(clip).toHaveAttribute("aria-busy", "true");
    const restore = page.getByRole("button", { name: restoreLabel });
    // If the old unsafe control is exposed, exercise the actual user action.
    if (await restore.isVisible()) await restore.click();
    await page.evaluate(async () => {
      await (
        window as unknown as { releaseRecoveryRead: () => Promise<void> }
      ).releaseRecoveryRead();
    });
    await expect(clip).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
    const materials = (await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!),
      `cosmora:composer-materials:${kind}:${id}`
    )) as { files: { name: string; content: string }[] };
    const result = {
      kind,
      text: await editor.inputValue(),
      files: materials.files,
      real_model_called: false
    };
    await receipt(info, "pending-file-readback", result);
    expect(result.text).toBe("");
    expect(result.files).toEqual([{ name: "pending.txt", content: "Новый ожидающий файл 00123" }]);
  });
}
