import { expect, test } from "@playwright/test";

// Optional diagnostic stress; never retries a failed case.
if (process.env.DRAFT_STRESS_CPU === "1") {
  test.beforeEach(async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
    await page.addInitScript(() => {
      const records: unknown[] = [];
      (window as unknown as { draftProbe: unknown[] }).draftProbe = records;
      const remember = (kind: string, key: string, value: string) => {
        if (records.length < 250)
          records.push({ kind, key, value, at: performance.now(), url: location.search });
      };
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("cosmora:composer-draft:")) remember("storage", key, value);
        return write.call(this, key, value);
      };
      document.addEventListener(
        "input",
        (event) => {
          if (event.target instanceof HTMLTextAreaElement)
            remember("input", event.target.id, event.target.value);
        },
        true
      );
    });
  });
  test.afterEach(async ({ page }, info) => {
    if (info.status !== info.expectedStatus && !page.isClosed()) {
      const records = await page.evaluate(
        () => (window as unknown as { draftProbe: unknown[] }).draftProbe
      );
      await info.attach("draft-probe", {
        body: JSON.stringify(records, null, 2),
        contentType: "application/json"
      });
    }
  });
}

const draftFiles = [
  { name: "draft.ts", mimeType: "text/plain", buffer: Buffer.from("export const saved = true;") }
];

test("new chat during a delayed initial read stays usable and ignores the late response", async ({
  page,
  request
}) => {
  const response = await request.post("/api/v1/chats", {
    data: { initial_message: "Delayed initial history", client_message_id: crypto.randomUUID() }
  });
  const { chat } = (await response.json()) as { chat: { id: string } };
  let release!: () => void;
  let intercepted!: () => void;
  let completed!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    completed = resolve;
  });
  await page.route(`**/api/v1/chats/${chat.id}`, async (route) => {
    const detail = await route.fetch();
    intercepted();
    await held;
    await route.fulfill({ response: detail });
    completed();
  });
  await page.goto(`/?chat=${chat.id}`);
  await started;
  await expect(page.getByLabel("Сообщение Kosmora")).toBeDisabled();
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  await page.getByLabel("Сообщение Kosmora").fill("Текст нового чата");
  release();
  await finished;
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Текст нового чата");
  await expect(page.locator(".message.user")).toHaveCount(0);
  await expect(page).not.toHaveURL(/chat=/);
});

test("restores text and files after closing the tab, isolates chats, removes and clears accepted drafts", async ({
  page,
  context,
  request
}, testInfo) => {
  const response = await request.post("/api/v1/chats", {
    data: { initial_message: "Чат для черновика", client_message_id: crypto.randomUUID() }
  });
  const { chat } = (await response.json()) as { chat: { id: string } };
  await page.goto(`/?chat=${chat.id}`);
  await page.getByLabel("Сообщение Kosmora").fill("Несохранённый текст");
  await page.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  expect(await page.getByLabel("Сообщение Kosmora").inputValue()).toBe("Несохранённый текст");
  expect(
    await page.evaluate((id) => localStorage.getItem(`cosmora:composer-draft:chat:${id}`), chat.id)
  ).toBe("Несохранённый текст");
  const url = page.url();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel("Сообщение Kosmora")).toHaveValue("Несохранённый текст");
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "draft.ts"
  );
  await reopened
    .locator(".sidebar")
    .getByRole("button", { name: "Новый чат", exact: true })
    .click();
  await expect(reopened.getByLabel("Сообщение Kosmora")).toHaveValue("");
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await reopened.goto(url);
  await reopened.getByRole("button", { name: "Удалить draft.ts" }).click();
  await reopened.reload();
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await reopened.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  const acknowledgement = reopened.waitForResponse(
    (reply) =>
      reply.request().method() === "POST" &&
      new URL(reply.url()).pathname === `/api/v1/chats/${chat.id}/messages`
  );
  await reopened.getByRole("button", { name: "Отправить", exact: true }).click();
  const accepted = await acknowledgement;
  const acceptedBody = (await accepted.json()) as { error?: { code?: string } };
  expect(
    accepted.ok(),
    `HTTP ${accepted.status()}: ${acceptedBody.error?.code ?? "accepted"}`
  ).toBe(true);
  try {
    await expect(reopened.getByRole("status")).toHaveText(/Ответ получен/);
  } catch (error) {
    // Preserve the original assertion even if diagnostic retrieval itself fails.
    await request
      .get(`/api/v1/chats/${chat.id}`, { timeout: 3000 })
      .then(async (detail) => {
        const body = await detail.json();
        await testInfo.attach("draft-chat-terminal-state", {
          body: JSON.stringify(
            {
              status: detail.status(),
              messages: body.messages?.map(
                (message: { role: string; status: string; error_code: string | null }) => ({
                  role: message.role,
                  status: message.status,
                  error_code: message.error_code
                })
              )
            },
            null,
            2
          ),
          contentType: "application/json"
        });
      })
      .catch(() => undefined);
    throw error;
  }
  await reopened.reload();
  await expect(reopened.getByLabel("Сообщение Kosmora")).toHaveValue("");
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await expect(reopened.locator(".message.user")).toHaveCount(2);
});

test("retains project materials across reload without leaking into the new-chat draft", async ({
  page,
  request
}) => {
  const response = await request.post("/api/v1/projects", {
    data: { initial_message: "Проект для материалов", client_message_id: crypto.randomUUID() }
  });
  const { project } = (await response.json()) as { project: { id: string } };
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByLabel("Сообщение менеджеру")).toBeEnabled();
  await page.getByLabel("Сообщение менеджеру").fill("Материалы проекта");
  await page.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  await page.reload();
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("Материалы проекта");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("recovers text with invalid saved materials and retains a draft on rejected submission", async ({
  page
}) => {
  await page.goto("/");
  await page.addInitScript(() => {
    if (sessionStorage.getItem("corrupt-draft-fixture")) return;
    sessionStorage.setItem("corrupt-draft-fixture", "done");
    localStorage.setItem("cosmora:composer-draft:new-chat", "Доступный текст");
    localStorage.setItem(
      "cosmora:composer-materials:new-chat",
      JSON.stringify({ version: 1, savedAt: Date.now(), files: [null] })
    );
  });
  await page.reload();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Доступный текст");
  await expect(page.locator(".composer").getByRole("alert")).toContainText(
    "Доступный текст сохранён"
  );
  await page.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({ status: 503, body: "Unavailable" });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Доступный текст");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
});

test("prepares a phone-sized JPEG, restores thumbnail and rejects unsafe dimensions", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 4032;
    canvas.height = 3024;
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    let seed = 123;
    for (let i = 0; i < pixels.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = seed & 255;
      pixels.data[i + 1] = (seed >>> 8) & 255;
      pixels.data[i + 2] = (seed >>> 16) & 255;
      pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1]!;
  });
  expect(Buffer.from(data, "base64").length).toBeGreaterThan(1_000_000);
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "phone.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(data, "base64")
  });
  const image = page.locator(".attachment-thumbnail");
  await expect(image).toBeVisible();
  const prepared = await image.evaluate((img: HTMLImageElement) => ({
    width: img.naturalWidth,
    height: img.naturalHeight,
    bytes: atob(img.src.split(",")[1]!).length
  }));
  expect(prepared.bytes).toBeLessThanOrEqual(1_000_000);
  expect(prepared.width * prepared.height).toBeLessThanOrEqual(8_000_000);
  expect(prepared.width / prepared.height).toBeCloseTo(4 / 3, 2);
  await page.screenshot({ path: test.info().outputPath("phone-composer.png"), fullPage: true });
  await page.reload();
  await expect(page.locator(".attachment-thumbnail")).toBeVisible();
  const unsafe = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(unsafe);
  unsafe.write("IHDR", 12);
  unsafe.writeUInt32BE(12001, 16);
  unsafe.writeUInt32BE(1, 20);
  await page
    .getByLabel("Текстовые файлы и код")
    .setInputFiles({ name: "huge.png", mimeType: "image/png", buffer: unsafe });
  await expect(page.locator(".composer").getByRole("alert")).toContainText("48 миллионов");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("phone.jpg");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("keeps attachment controls keyboard reachable with clear names and thumbnail text", async ({
  page
}) => {
  await page.goto("/");
  const clip = page.getByRole("button", { name: "Прикрепить файл" });
  await expect(clip).toBeEnabled();
  await clip.focus();
  await expect(clip).toBeFocused();
  await expect(clip).toHaveAttribute("title", "Прикрепить файл или фото");
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "accessible.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("keyboard")
  });
  const remove = page.getByRole("button", { name: "Удалить accessible.txt" });
  await expect(remove).toHaveAttribute("title", "Удалить accessible.txt");
  await remove.focus();
  await expect(remove).toBeFocused();
  await remove.press("Enter");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("announces rejected attachment type and keeps the draft editor usable", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Оставь этот текст");
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "unsupported.exe",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("binary")
  });
  await expect(page.locator(".composer").getByRole("alert")).toContainText("Поддерживаются");
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Оставь этот текст");
  await expect(page.getByRole("button", { name: "Прикрепить файл" })).toBeEnabled();
});

test("restored attachment drafts expose the image name to assistive technology", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByLabel("Текстовые файлы и код")).toBeEnabled();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#2463eb";
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "accessible.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64")
  });
  await expect(page.locator(".attachment-thumbnail")).toHaveAttribute(
    "alt",
    "accessible.png миниатюра"
  );
  await page.reload();
  await expect(page.locator(".attachment-thumbnail")).toHaveAttribute(
    "alt",
    "accessible.png миниатюра"
  );
  await expect(page.getByRole("button", { name: "Удалить accessible.png" })).toBeEnabled();
});

for (const kind of ["personal", "project"] as const)
  test(`retries an accepted ${kind} chat message with its original attachment after a lost response`, async ({
    page,
    request
  }) => {
    const projectId = kind === "project" ? crypto.randomUUID() : null;
    if (projectId) {
      const response = await request.post("/api/v1/projects/empty", {
        data: { title: "Проверка повтора", client_project_id: projectId }
      });
      expect(response.status()).toBe(201);
    }
    const posts: unknown[] = [];
    const statuses: number[] = [];
    await page.route(
      projectId ? `**/api/v1/projects/${projectId}/messages` : "**/api/v1/chats",
      async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        posts.push(route.request().postDataJSON());
        const response = await route.fetch();
        statuses.push(response.status());
        if (posts.length === 1) await route.abort("connectionreset");
        else await route.fulfill({ response });
      }
    );
    await page.goto(projectId ? `/?project=${projectId}` : "/");
    const text = "Надёжность: восстановление потока";
    const editor = page.getByLabel(projectId ? "Сообщение менеджеру" : "Сообщение Kosmora");
    const send = page.getByRole("button", { name: "Отправить", exact: true });
    await editor.fill(text);
    await page.getByLabel("Текстовые файлы и код").setInputFiles({
      name: "retry.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Сохранённое вложение")
    });
    await send.click();
    await expect(page.locator(".composer").getByText(/результат запроса неизвестен/)).toBeVisible();
    await expect(editor).toHaveValue(text);
    await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
      "retry.txt"
    );
    if (!projectId) {
      await page.reload();
      await expect(editor).toHaveValue(text);
      await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
        "retry.txt"
      );
    }
    await send.click();
    await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
    expect(statuses).toEqual([projectId ? 202 : 201, 200]);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[0]).toMatchObject({
      attachments: [{ name: "retry.txt", content: "Сохранённое вложение" }]
    });
    await expect(page.locator(".message.user")).toHaveCount(1);
    await expect(page.locator(".message.assistant")).toHaveCount(1);
    expect(
      await page.evaluate(() => sessionStorage.getItem("cosmora:pending-chat-sends:v2"))
    ).toBeNull();
  });

test("two uncertain sends remain independently retryable after navigation and reload", async ({
  page,
  request
}) => {
  const createChat = async (initialMessage: string, content: string) => {
    const response = await request.post("/api/v1/chats", {
      data: { initial_message: initialMessage, client_message_id: crypto.randomUUID() }
    });
    expect(response.status()).toBe(201);
    const { chat } = (await response.json()) as { chat: { id: string } };
    const posts: unknown[] = [];
    const statuses: number[] = [];
    await page.route("**/api/v1/chats/" + chat.id + "/messages", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts.push(route.request().postDataJSON());
      const accepted = await route.fetch();
      statuses.push(accepted.status());
      if (posts.length === 1) await route.abort("connectionreset");
      else await route.fulfill({ response: accepted });
    });
    return { id: chat.id, content, posts, statuses };
  };
  const first = await createChat("История проверки повтора", "Первое сообщение без подтверждения");
  const second = await createChat("Другой чат для проверки", "Второе сообщение без подтверждения");
  const editor = page.getByLabel("Сообщение Kosmora");
  const send = page.getByRole("button", { name: "Отправить", exact: true });
  const markers = () =>
    page.evaluate(() => sessionStorage.getItem("cosmora:pending-chat-sends:v2"));
  const selectChat = async (id: string) => {
    await page
      .locator(".sidebar button.chat-item")
      .filter({ has: page.locator("#pin-chat-" + id) })
      .click();
    await expect(page).toHaveURL(new RegExp("[?&]chat=" + id));
  };
  const sendWithoutAcknowledgement = async (content: string) => {
    await expect(editor).toHaveValue("");
    await editor.fill(content);
    await send.click();
    await expect(page.locator(".composer").getByText(/результат запроса неизвестен/)).toBeVisible();
  };

  await page.goto("/?chat=" + first.id);
  await sendWithoutAcknowledgement(first.content);
  await selectChat(second.id);
  await sendWithoutAcknowledgement(second.content);
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page).not.toHaveURL(/chat=/);
  const saved = (await markers()) ?? "[]";
  expect(JSON.parse(saved)).toHaveLength(2);
  for (const chat of [first, second]) {
    expect(saved).not.toContain(chat.id);
    expect(saved).not.toContain(chat.content);
  }

  await page.reload();
  for (const chat of [first, second]) {
    await selectChat(chat.id);
    await expect(editor).toHaveValue(chat.content);
    await expect(page.locator(".message.user").filter({ hasText: chat.content })).toHaveCount(1);
    await send.click();
    await expect.poll(() => chat.statuses).toEqual([202, 200]);
    expect(chat.posts[1]).toEqual(chat.posts[0]);
    await expect(editor).toHaveValue("");
    await expect(page.locator(".message.user").filter({ hasText: chat.content })).toHaveCount(1);
  }
  expect(await markers()).toBeNull();
});

test("composer actions belong to their own chat and stay out of another chat request", async ({
  page,
  request
}) => {
  const createChat = async (initialMessage: string) => {
    const response = await request.post("/api/v1/chats", {
      data: { initial_message: initialMessage, client_message_id: crypto.randomUUID() }
    });
    expect(response.status()).toBe(201);
    return ((await response.json()) as { chat: { id: string } }).chat.id;
  };
  const first = await createChat("Черновик с поиском");
  const second = await createChat("Обычный черновик");
  const selectChat = async (id: string) => {
    await page
      .locator(".sidebar button.chat-item")
      .filter({ has: page.locator("#pin-chat-" + id) })
      .click();
    await expect(page).toHaveURL(new RegExp("[?&]chat=" + id));
  };

  await page.goto("/?chat=" + first);
  const editor = page.getByLabel("Сообщение Kosmora");
  const webSearch = page.getByRole("checkbox", { name: "Искать в интернете" });
  const defaultAction = page.getByRole("button", { name: "Действие с текстом", exact: true });
  const explain = page.getByRole("button", { name: "Объяснить тему", exact: true });
  await editor.fill("Первый черновик");
  await webSearch.check();
  await defaultAction.click();
  await page.getByRole("menuitem", { name: "Объяснить тему", exact: true }).click();
  await expect(explain).toBeVisible();

  await selectChat(second);
  await expect(webSearch).not.toBeChecked();
  await expect(defaultAction).toBeVisible();
  await editor.fill("Обычное сообщение");
  const sent = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/chats/" + second + "/messages"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const payload = (await sent).postDataJSON() as Record<string, unknown>;
  expect(payload).toHaveProperty("content", "Обычное сообщение");
  expect(payload).not.toHaveProperty("web_search");
  expect(payload).not.toHaveProperty("text_action");
  await expect(editor).toHaveValue("");

  await selectChat(first);
  await expect(editor).toHaveValue("Первый черновик");
  await expect(webSearch).toBeChecked();
  await expect(explain).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(webSearch).not.toBeChecked();
  await expect(defaultAction).toBeVisible();
});

test("reload and lost network recover the same run without duplicate POSTs or messages", async ({
  page,
  context
}) => {
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/v1\/chats(?:\/[^/]+\/messages)?$/.test(request.url())
    )
      posts++;
  });
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Надёжность: восстановление потока");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText("Начало ответа.");
  const url = page.url();
  await page.reload();
  await expect(page.locator(".message.assistant")).toContainText("Начало ответа.");
  await context.setOffline(true);
  await page.waitForTimeout(1100);
  await context.setOffline(false);
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  expect(page.url()).toBe(url);
  expect(posts).toBe(1);
  await expect(page.locator(".message.user")).toHaveCount(1);
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.locator(".message.assistant")).toContainText("Часть 10.");
  expect(
    (await page.locator(".message.assistant").innerText()).match(/Начало ответа\./g)
  ).toHaveLength(1);
});

test("late history and stream cannot affect the newly selected chat", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Надёжность: восстановление потока");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText("Начало ответа.");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  await page.route("**/api/v1/chats/*", async (route) => {
    if (route.request().method() !== "GET" || /\/messages$/.test(route.request().url())) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    intercepted();
    await held;
    await route.fulfill({ response });
  });
  await started;
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await page.getByLabel("Сообщение Kosmora").fill("Новый черновик");
  release();
  await page.waitForTimeout(1100);
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Новый черновик");
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
});

test("long Markdown retains the complete answer in copy and chat export", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Надёжность: длинный Markdown");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  const reply = page.locator(".message.assistant");
  await expect(reply.getByRole("heading", { name: "Большой результат" })).toBeVisible();
  await reply.getByRole("button", { name: "Копировать код", exact: true }).click();
  expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")).toBe(
    "export const value = 42;\n".repeat(800)
  );
  await reply.getByRole("button", { name: "Копировать ответ", exact: true }).click();
  const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
  expect(copied.length).toBeGreaterThan(35000);
  expect(copied).toContain("| Код | Готов |");
  await expect(reply.getByRole("button", { name: "Скачать ответ", exact: true })).toHaveCount(0);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByLabel("Формат файла", { exact: true }).selectOption("markdown");
  await page.getByRole("button", { name: "Скачать переписку", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk as Buffer));
  expect(Buffer.concat(chunks).toString("utf8").replace(/\r\n/g, "\n")).toContain(copied);
});

test("ordinary-chat cancellation after reload restores a request without sending it", async ({
  page
}) => {
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Останови этот тестовый запуск");
  await page.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Тестовый запуск ожидает остановки."
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Остановить", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(/Остановлен/);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") posts++;
  });
  await page.getByRole("button", { name: "Вернуть запрос в редактор" }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Останови этот тестовый запуск");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  expect(posts).toBe(0);
});

test("a pre-completion history snapshot cannot reopen a completed run", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Сообщение Kosmora").fill("Надёжность: восстановление потока");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText("Начало ответа.");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted!: () => void;
  const started = new Promise<void>((resolve) => {
    intercepted = resolve;
  });
  let first = true;
  await page.route("**/api/v1/chats/*", async (route) => {
    if (route.request().method() !== "GET" || !first) {
      await route.continue();
      return;
    }
    first = false;
    const response = await route.fetch();
    intercepted();
    await held;
    await route.fulfill({ response });
  });
  await started;
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  release();
  await page.waitForTimeout(1100);
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await expect(page.getByRole("button", { name: "Остановить", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
});

test("a lost acknowledgement reload restores the exact text action before retrying one request", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/chats", {
    data: {
      initial_message: "История для восстановления действия",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { chat } = (await created.json()) as { chat: { id: string } };
  const posts: Array<Record<string, unknown>> = [];
  const statuses: number[] = [];
  await page.route(`**/api/v1/chats/${chat.id}/messages`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    statuses.push(response.status());
    if (posts.length === 1) await route.abort("connectionreset");
    else await route.fulfill({ response });
  });
  await page.goto(`/?chat=${chat.id}`);
  const editor = page.getByLabel("Сообщение Kosmora");
  const send = page.getByRole("button", { name: "Отправить", exact: true });
  await editor.fill("Объясни тестовый пример 00123");
  await page.getByRole("button", { name: "Действие с текстом", exact: true }).click();
  await page.getByRole("menuitem", { name: "Объяснить тему", exact: true }).click();
  await send.click();
  await expect(page.locator(".composer").getByText(/результат запроса неизвестен/)).toBeVisible();
  expect(posts[0]).toMatchObject({ text_action: { kind: "explain" } });
  await page.reload();
  await expect(editor).toHaveValue("Объясни тестовый пример 00123");
  await expect(page.getByRole("button", { name: "Объяснить тему", exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  await send.click();
  await expect.poll(() => statuses).toEqual([202, 200]);
  expect(posts[1]).toEqual(posts[0]);
  await expect(editor).toHaveValue("");
  await expect(
    page.locator(".message.user").filter({ hasText: "Объясни тестовый пример 00123" })
  ).toHaveCount(1);
});
