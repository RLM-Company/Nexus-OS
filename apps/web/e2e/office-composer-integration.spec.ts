import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { unzipSync, strFromU8 } from "fflate";

test("a verified Office copy preserves the prepared message and attachment across navigation", async ({
  page
}, info) => {
  const input = JSON.parse(
    await readFile(
      resolve(process.cwd(), "../../docs/handoff/fixtures/kosmora-composer/input.json"),
      "utf8"
    )
  ) as {
    text: string;
    file: { name: string; mimeType: string; content: string };
  };
  const sourcePath = resolve(
    process.cwd(),
    "../../docs/handoff/fixtures/koswork-office/offer.docx"
  );
  const source = await readFile(sourcePath);
  const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
  let modelPosts = 0;
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      (/^\/api\/v1\/chats(?:\/[^/]+\/messages)?$/.test(path) ||
        /^\/api\/v1\/projects\/[^/]+\/(messages|work)$/.test(path))
    )
      modelPosts++;
  });
  await page.goto("/?mode=kosmora");
  await page.getByLabel("Сообщение Kosmora", { exact: true }).fill(input.text);
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: input.file.name,
    mimeType: input.file.mimeType,
    buffer: Buffer.from(input.file.content, "utf8")
  });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    input.file.name
  );

  await page.goto("/?surface=files");
  const editor = page.getByRole("region", { name: "Рабочие документы Koswork", exact: true });
  await editor.locator('input[type="file"]').setInputFiles(sourcePath);
  await expect(editor).toContainText("sha256:" + digest(source));
  await editor.getByLabel("Адрес", { exact: true }).selectOption("paragraph:3");
  await editor.getByLabel("Найти точный текст").fill("Компания А");
  await editor.getByLabel("Заменить на").fill("Компания Б");
  await editor.getByRole("button", { name: "Добавить замену в план" }).click();
  await editor.getByRole("button", { name: "Посмотреть изменения" }).click();
  await expect(editor.getByRole("heading", { name: "Предлагаемые изменения" })).toBeVisible();
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toHaveCount(0);
  const responsePending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/document-workspace/commit" &&
      response.request().method() === "POST"
  );
  await editor.getByRole("button", { name: "Подтвердить подготовку новой копии" }).click();
  const response = await responsePending;
  expect(response.status()).toBe(200);
  const receipt = (await response.json()) as {
    source_version: string;
    version: string;
    sha256: string;
    bytes: string;
  };
  await expect(editor.getByRole("link", { name: "Скачать новую копию" })).toBeVisible();
  const downloadPending = page.waitForEvent("download");
  await editor.getByRole("link", { name: "Скачать новую копию" }).click();
  const download = await downloadPending;
  const bytes = await readFile((await download.path())!);
  expect(receipt.source_version).toBe("sha256:" + digest(source));
  expect(receipt.version).toBe("sha256:" + digest(bytes));
  expect(receipt.sha256).toBe(digest(bytes));
  expect(Buffer.from(receipt.bytes, "base64").equals(bytes)).toBe(true);
  const text = strFromU8(unzipSync(bytes)["word/document.xml"]!).replace(/<[^>]+>/g, "");
  for (const value of ["Компания Б", "19 700", "00123", "07.11.2026", "кроме доставки"])
    expect(text).toContain(value);
  expect((await readFile(sourcePath)).equals(source)).toBe(true);

  await page.goto("/?mode=kosmora");
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(input.text);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    input.file.name
  );
  await page.reload();
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toHaveValue(input.text);
  const restored = await page.evaluate(() => ({
    text: localStorage.getItem("cosmora:composer-draft:new-chat"),
    materials: JSON.parse(
      localStorage.getItem("cosmora:composer-materials:new-chat") ?? "null"
    ) as {
      files: { name: string; content: string }[];
    }
  }));
  expect(restored.text).toBe(input.text);
  expect(restored.materials.files).toHaveLength(1);
  expect(restored.materials.files[0]).toMatchObject({
    name: input.file.name,
    content: input.file.content
  });
  expect(modelPosts).toBe(0);
  const report = {
    source_version: receipt.source_version,
    result_version: receipt.version,
    result_sha256: digest(bytes),
    office_text: text,
    source_preserved: true,
    restored_draft: restored.text,
    restored_file: restored.materials.files[0],
    restored_file_sha256: digest(restored.materials.files[0]!.content),
    browser_model_posts: modelPosts,
    real_model_called: false,
    visual_render_verified: false
  };
  const reportPath = info.outputPath("office-composer-integration.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  await info.attach("office-composer-integration", {
    path: reportPath,
    contentType: "application/json"
  });
});
