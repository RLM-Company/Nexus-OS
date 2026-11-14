import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { strFromU8, unzipSync, zipSync } from "fflate";

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
  await expect(
    library
      .getByRole("group", { name: "Сохранённые документы" })
      .getByText("договор.txt", { exact: true })
  ).toBeVisible();
  await expect(library).toContainText("Готов");
  await page.reload();
  await expect(
    library
      .getByRole("group", { name: "Сохранённые документы" })
      .getByText("договор.txt", { exact: true })
  ).toBeVisible();
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
  await expect(
    library
      .getByRole("group", { name: "Сохранённые документы" })
      .getByText("договор.txt", { exact: true })
  ).toHaveCount(0);
  await expect(library).toContainText("В проекте пока нет сохранённых документов.");
});

test("imports a raster PDF from ZIP and cites the scanned page", async ({ page, request }) => {
  test.setTimeout(90_000);
  const project = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: { initial_message: "Проверка распознавания", client_message_id: randomUUID() }
  });
  expect(project.ok()).toBe(true);
  const accepted = (await project.json()) as { project: { id: string } };
  await page.goto("/?project=" + encodeURIComponent(accepted.project.id) + "&surface=files");
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 400;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 1200, 400);
    ctx.fillStyle = "#000";
    ctx.font = "54px Arial";
    ctx.fillText("Договор: бюджет 42000 рублей", 55, 170);
    ctx.fillText("Agreement: October 2027", 55, 255);
    return canvas.toDataURL("image/jpeg", 0.95).split(",")[1]!;
  });
  const image = Buffer.from(jpeg, "base64");
  const commands = "q 600 0 0 200 0 0 cm /Im0 Do Q";
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"
    ),
    Buffer.concat([
      Buffer.from(
        "<< /Type /XObject /Subtype /Image /Width 1200 /Height 400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
          image.length +
          " >>\nstream\n"
      ),
      image,
      Buffer.from("\nendstream")
    ]),
    Buffer.from("<< /Length " + commands.length + " >>\nstream\n" + commands + "\nendstream")
  ];
  const pdf = [Buffer.from("%PDF-1.4\n")];
  let offset = pdf[0]!.length;
  const xref = ["0000000000 65535 f "];
  for (const [index, object] of objects.entries()) {
    xref.push(String(offset).padStart(10, "0") + " 00000 n ");
    const part = Buffer.concat([
      Buffer.from(index + 1 + " 0 obj\n"),
      object,
      Buffer.from("\nendobj\n")
    ]);
    pdf.push(part);
    offset += part.length;
  }
  pdf.push(
    Buffer.from(
      "xref\n0 6\n" +
        xref.join("\n") +
        "\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
        offset +
        "\n%%EOF\n"
    )
  );
  const library = page.getByRole("region", { name: "Библиотека проекта", exact: true });
  await library.locator('input[type="file"]').setInputFiles({
    name: "incoming.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipSync({ "contract/scan.pdf": Buffer.concat(pdf) }))
  });
  await expect(library).toContainText("Страниц с текстом: 1 из 1", { timeout: 60_000 });
  await library.getByLabel("Вопрос к документам").fill("бюджет");
  await library.getByRole("button", { name: "Найти источники", exact: true }).click();
  await expect(library).toContainText("scan.pdf, стр. 1");
  await expect(library).toContainText("42000");
});
