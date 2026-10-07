import { expect, test } from "@playwright/test";
import { zipSync, strToU8 } from "fflate";

function pdfFixture(): Buffer {
  const stream = "BT /F1 12 Tf 20 80 Td (Kosmora project brief) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

test("extracts real PDF and DOCX locally, sends their text and restores it from history", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  const docx = zipSync({
    "word/document.xml": strToU8(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Требования Kosmora &amp; код</w:t></w:r></w:p></w:body></w:document>'
    )
  });
  await page.getByLabel("Текстовые файлы и код").setInputFiles([
    { name: "brief.pdf", mimeType: "application/pdf", buffer: pdfFixture() },
    {
      name: "requirements.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(docx)
    }
  ]);
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("brief.pdf");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "requirements.docx"
  );
  const question = `Объясни документы ${crypto.randomUUID()}`;
  await page.getByLabel("Сообщение Kosmora").fill(question);
  const accepted = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/chats") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const response = await accepted;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().attachments).toEqual([
    { name: "brief.pdf", source_type: "pdf", content: "Kosmora project brief" },
    { name: "requirements.docx", source_type: "docx", content: "Требования Kosmora & код" }
  ]);
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await page.reload();
  await page
    .locator(".sidebar")
    .getByRole("button")
    .filter({ has: page.locator("strong", { hasText: question.slice(0, 50) }) })
    .click();
  const files = page.getByLabel("Файлы сообщения");
  await files.locator("summary").filter({ hasText: "brief.pdf" }).click();
  await expect(files.locator("details").filter({ hasText: "brief.pdf" }).locator("pre")).toHaveText(
    "Kosmora project brief"
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать brief.pdf" }).click();
  expect((await downloaded).suggestedFilename()).toBe("brief.pdf.txt");
});

test("bounds DOCX decompression and rejects corrupt images before sending", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  const zip = zipSync({ "word/document.xml": strToU8("x".repeat(600_000)) });
  const input = page.getByLabel("Текстовые файлы и код");
  await input.setInputFiles({
    name: "bomb.docx",
    mimeType: "application/zip",
    buffer: Buffer.from(zip)
  });
  await expect(page.locator(".composer").getByRole("alert")).toContainText("после распаковки");
  await input.setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("not an image")
  });
  await expect(page.locator(".composer").getByRole("alert")).toContainText("PNG/JPEG");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toHaveCount(0);
});

test("stores a real PNG with a multimodal payload, preserving the image when the route lacks vision", async ({
  page
}) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Прикрепить файл", exact: true })).toBeEnabled();
  const data = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 10;
    canvas.height = 10;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#275cff";
    context.fillRect(0, 0, 10, 10);
    return canvas.toDataURL("image/png").split(",")[1]!;
  });
  await page.getByLabel("Текстовые файлы и код").setInputFiles({
    name: "square.png",
    mimeType: "image/png",
    buffer: Buffer.from(data, "base64")
  });
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText("square.png");
  await page.getByLabel("Сообщение Kosmora").fill("Посмотри изображение");
  const accepted = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/chats") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const response = await accepted;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().attachments).toEqual([
    { kind: "image", name: "square.png", media_type: "image/png", data_base64: data }
  ]);
  const id = (await response.json()).chat.id as string;
  const history = await page.request.get(`/api/v1/chats/${id}`);
  expect((await history.json()).messages[0].attachments[0].data_base64).toBe(data);
  await page.getByLabel("Файлы сообщения").locator("summary").click();
  await expect(page.getByRole("img", { name: "square.png" })).toBeVisible();
  expect(
    await page
      .getByRole("img", { name: "square.png" })
      .evaluate((image: HTMLImageElement) => image.naturalWidth)
  ).toBe(10);
});
