import { expect, test } from "@playwright/test";

const draftFiles = [
  { name: "draft.ts", mimeType: "text/plain", buffer: Buffer.from("export const saved = true;") }
];

test("restores text and files after closing the tab, isolates chats, removes and clears accepted drafts", async ({
  page,
  context,
  request
}) => {
  const response = await request.post("/api/v1/chats", {
    data: { initial_message: "Чат для черновика", client_message_id: crypto.randomUUID() }
  });
  const { chat } = (await response.json()) as { chat: { id: string } };
  await page.goto(`/?chat=${chat.id}`);
  await page.getByLabel("Сообщение Cosmora").fill("Несохранённый текст");
  await page.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  expect(await page.getByLabel("Сообщение Cosmora").inputValue()).toBe("Несохранённый текст");
  expect(
    await page.evaluate((id) => localStorage.getItem(`cosmora:composer-draft:chat:${id}`), chat.id)
  ).toBe("Несохранённый текст");
  const url = page.url();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(url);
  await expect(reopened.getByLabel("Сообщение Cosmora")).toHaveValue("Несохранённый текст");
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "draft.ts"
  );
  await reopened
    .locator(".sidebar")
    .getByRole("button", { name: "Новый чат", exact: true })
    .click();
  await expect(reopened.getByLabel("Сообщение Cosmora")).toHaveValue("");
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await reopened.goto(url);
  await reopened.getByRole("button", { name: "Удалить draft.ts" }).click();
  await reopened.reload();
  await expect(reopened.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await reopened.getByLabel("Текстовые файлы и код").setInputFiles(draftFiles);
  await reopened.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(reopened.getByRole("status")).toHaveText(/Ответ получен/);
  await reopened.reload();
  await expect(reopened.getByLabel("Сообщение Cosmora")).toHaveValue("");
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
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("");
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
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Доступный текст");
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
  await expect(page.getByLabel("Сообщение Cosmora")).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Доступный текст");
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
  await page.getByLabel("Сообщение Cosmora").fill("Надёжность: восстановление потока");
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
  await page.getByLabel("Сообщение Cosmora").fill("Надёжность: восстановление потока");
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
  await page.getByLabel("Сообщение Cosmora").fill("Новый черновик");
  release();
  await page.waitForTimeout(1100);
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Новый черновик");
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
});

test("long Markdown and code copy and download retain the complete answer", async ({
  page,
  context
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Надёжность: длинный Markdown");
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
  const downloaded = page.waitForEvent("download");
  await reply.getByRole("button", { name: "Скачать ответ", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("cosmora-answer.md");
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk as Buffer));
  expect(Buffer.concat(chunks).toString("utf8")).toBe(copied);
});

test("ordinary-chat cancellation after reload restores a request without sending it", async ({
  page
}) => {
  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Останови этот тестовый запуск");
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
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Останови этот тестовый запуск");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("draft.ts");
  expect(posts).toBe(0);
});

test("a pre-completion history snapshot cannot reopen a completed run", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Надёжность: восстановление потока");
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
  await expect(page.getByLabel("Сообщение Cosmora")).toBeEnabled();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
});
