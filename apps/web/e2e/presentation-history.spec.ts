import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test("presentation history restores saved content and imports a portable copy with speaker notes", async ({
  page
}) => {
  await page.goto("/presentations");
  await page.getByRole("textbox", { name: "Название", exact: true }).fill("История доклада");
  await page.getByRole("button", { name: "+ Создать", exact: true }).click();
  const editor = page.getByRole("region", { name: "Редактор презентации", exact: true });
  const heading = editor.getByRole("textbox", { name: "Заголовок", exact: true });
  const notes = editor.getByRole("textbox", { name: /Заметки докладчика/ });
  await heading.fill("Сохранённая правка");
  await notes.fill("Заметки & <текст>\nВторая строка");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "История версий", exact: true }).click();
  await page.getByRole("button", { name: "Посмотреть версию 1", exact: true }).click();
  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Восстановить версию 1", exact: true }).click();
  await expect(heading).toHaveValue("История доклада");
  await expect(editor.getByText("Версия 3 · текущая", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Посмотреть версию 2", exact: true }).click();
  await page.getByRole("button", { name: "Восстановить версию 2", exact: true }).click();
  await expect(heading).toHaveValue("Сохранённая правка");
  await expect(notes).toHaveValue("Заметки & <текст>\nВторая строка");
  const jsonDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const exported = await jsonDownload;
  const bytes = await readFile((await exported.path())!);
  const portable = JSON.parse(bytes.toString()) as {
    format: string;
    slides: { id: string; notes: string }[];
  };
  expect(portable.format).toBe("kosmora-presentation-v1");
  expect(portable).not.toHaveProperty("owner_id");
  const importedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/presentations/import") && response.request().method() === "POST"
  );
  await page
    .getByLabel("Импорт JSON Kosmora")
    .setInputFiles({ name: "deck.json", mimeType: "application/json", buffer: bytes });
  await page.getByRole("button", { name: "Импортировать копию", exact: true }).click();
  const imported = (await (await importedResponse).json()) as {
    slides: { id: string; notes: string }[];
  };
  expect(imported.slides[0]?.id).not.toBe(portable.slides[0]?.id);
  await expect(notes).toHaveValue(portable.slides[0]!.notes);
  await page.reload();
  await page
    .getByRole("button", { name: /История доклада/ })
    .first()
    .click();
  await expect(notes).toHaveValue(portable.slides[0]!.notes);
  const pptxDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PPTX", exact: true }).click();
  const pptx = await pptxDownload;
  const zip = unzipSync(new Uint8Array(await readFile((await pptx.path())!)));
  expect(strFromU8(zip["ppt/notesSlides/notesSlide1.xml"]!)).toContain(
    "Заметки &amp; &lt;текст&gt;"
  );
  expect(strFromU8(zip["ppt/slides/slide1.xml"]!)).not.toContain("Заметки");
  let imports = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/presentations/import")) imports++;
  });
  await page
    .getByLabel("Импорт JSON Kosmora")
    .setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"other"}')
    });
  await expect(page.getByRole("alert")).toContainText("Некорректный файл");
  expect(imports).toBe(0);
});
