import { expect, test } from "@playwright/test";

test("attaches code, removes a file, persists history and downloads the source", async ({
  page
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  const input = page.getByLabel("Текстовые файлы и код");
  await input.setInputFiles([
    {
      name: "example.ts",
      mimeType: "text/plain",
      buffer: Buffer.from("export const sum = (a: number, b: number) => a + b;\n// Пример")
    },
    { name: "remove.txt", mimeType: "text/plain", buffer: Buffer.from("Убрать до отправки") }
  ]);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("example.ts");
  await page.getByRole("button", { name: "Удалить remove.txt" }).click();
  await expect(page.getByRole("button", { name: "Удалить remove.txt" })).toHaveCount(0);
  const question = `Объясни функцию сложения ${crypto.randomUUID()}`;
  await page.getByLabel("Сообщение Cosmora").fill(question);
  const acceptedResponse = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/chats") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const accepted = await acceptedResponse;
  expect(accepted.status()).toBe(201);
  const requestBody = accepted.request().postDataJSON() as {
    attachments: { name: string; content: string }[];
  };
  expect(requestBody.attachments).toEqual([
    {
      name: "example.ts",
      content: "export const sum = (a: number, b: number) => a + b;\n// Пример"
    }
  ]);
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await page.reload();
  await page
    .locator(".sidebar")
    .getByRole("button")
    .filter({ has: page.locator("strong", { hasText: question.slice(0, 50) }) })
    .click();
  const files = page.getByLabel("Файлы сообщения");
  await expect(files).toContainText("example.ts");
  await files.locator("summary").click();
  await expect(files.locator("pre")).toHaveText(requestBody.attachments[0]!.content);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать example.ts" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("example.ts");
  await page.getByLabel("Сообщение Cosmora").fill("Как протестировать эту функцию?");
  const followUp = page.waitForResponse(
    (response) =>
      /\/chats\/[^/]+\/messages$/.test(response.url()) && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  expect((await followUp).status()).toBe(202);
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await page.screenshot({ path: testInfo.outputPath("chat-files.png"), fullPage: true });
});

test("rejects unsupported/binary files and drops attachments when opening a new chat", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  const input = page.getByLabel("Текстовые файлы и код");
  await input.setInputFiles({
    name: "document.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("test")
  });
  await expect(page.locator(".composer").getByRole("alert")).toContainText(
    "Не удалось прочитать PDF"
  );
  await input.setInputFiles({
    name: "binary.txt",
    mimeType: "text/plain",
    buffer: Buffer.from([0xff, 0xfe])
  });
  await expect(page.locator(".composer").getByRole("alert")).toContainText("UTF-8");
  await input.setInputFiles({
    name: "private.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Личный черновик")
  });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "private.txt"
  );
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("keeps files in the draft after a rejected send and fits a mobile screen", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "long-name-".repeat(10) + ".ts",
    mimeType: "text/plain",
    buffer: Buffer.from("const value = 1;")
  });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toBeVisible();
  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "UNAVAILABLE", message: "Попробуйте позже", retryable: true }
      })
    });
  });
  await page.getByLabel("Сообщение Cosmora").fill("Объясни файл");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".composer").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Объясни файл");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("does not attach a file to another chat when decoding finishes after navigation", async ({
  page
}) => {
  await page.addInitScript(() => {
    const original = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function () {
      if (this.name !== "slow.txt") return original.call(this);
      return new Promise<ArrayBuffer>((resolve) => {
        (window as unknown as { releaseAttachmentRead: () => void }).releaseAttachmentRead = () => {
          void original.call(this).then(resolve);
        };
      });
    };
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "slow.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Материал первого чата")
  });
  await expect(page.getByRole("status")).toHaveText("Читаю файлы…");
  await page.locator(".sidebar").getByRole("button", { name: "Новый чат", exact: true }).click();
  await page.evaluate(() =>
    (window as unknown as { releaseAttachmentRead: () => void }).releaseAttachmentRead()
  );
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
  await page.getByLabel("Сообщение Cosmora").fill("Второй чат без файлов");
  const responsePromise = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/chats") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const response = await responsePromise;
  expect(response.request().postDataJSON().attachments).toEqual([]);
});
