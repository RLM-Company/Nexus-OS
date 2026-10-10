import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";

test("persists original documents, searches cited evidence and exports an editable report", async ({
  page,
  request
}, testInfo) => {
  const project = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: { initial_message: "Библиотека документов", client_message_id: randomUUID() }
  });
  expect(project.ok(), await project.text()).toBe(true);
  const accepted = (await project.json()) as { project: { id: string } };
  expect(accepted.project.id).toBeTruthy();
  await page.goto(`/?project=${encodeURIComponent(accepted.project.id)}&surface=files`);
  const library = page.getByRole("region", { name: "Библиотека проекта", exact: true });
  const original = Buffer.from("Договор Kosmora\nБюджет проекта составляет 42000 рублей.", "utf8");
  await library.locator('input[type="file"]').setInputFiles({
    name: "договор.txt",
    mimeType: "text/plain",
    buffer: original
  });
  await expect(library.getByText("договор.txt", { exact: true })).toBeVisible();
  await expect(library).toContainText("Готов");
  await page.reload();
  await expect(library.getByText("договор.txt", { exact: true })).toBeVisible();
  const originalDownload = page.waitForEvent("download");
  await library.getByRole("link", { name: "Оригинал", exact: true }).click();
  const downloaded = await originalDownload;
  expect(await readFile((await downloaded.path())!)).toEqual(original);
  await library.getByLabel("Вопрос к документам").fill("бюджет проекта");
  await library.getByRole("button", { name: "Найти источники", exact: true }).click();
  await expect(library).toContainText("договор.txt, строки 1–2");
  await expect(library).toContainText("42000");
  const docxDownload = page.waitForEvent("download");
  await library.getByRole("button", { name: "Фрагменты DOCX", exact: true }).click();
  const report = await docxDownload;
  expect(report.suggestedFilename()).toBe("kosmora-source-report.docx");
  const files = unzipSync(await readFile((await report.path())!));
  const xml = strFromU8(files["word/document.xml"]!);
  expect(xml).toContain("42000");
  expect(xml).toContain("договор.txt");
  await page.screenshot({ path: testInfo.outputPath("document-library.png"), fullPage: true });
  await library
    .getByRole("button", { name: "Прикрепить к чату и задать вопрос", exact: true })
    .click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue(/бюджет проекта/);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "kosmora-library-sources.txt"
  );
  // Preparing cited context must not start a model request.
  await page.goto(`/?project=${encodeURIComponent(accepted.project.id)}&surface=files`);
  await library.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(library.getByText("договор.txt", { exact: true })).toHaveCount(0);
  await expect(library).toContainText("В проекте пока нет сохранённых документов.");
});
