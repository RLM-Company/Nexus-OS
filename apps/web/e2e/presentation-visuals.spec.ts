import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";

const imageFile = join(__dirname, "fixtures/presentation-studio.png");

async function downloadSlides(page: Page, file?: string) {
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PPTX", exact: true }).click();
  const download = await downloading;
  if (file) await download.saveAs(file);
  return unzipSync(new Uint8Array(await readFile(await download.path())));
}

test("exports a native picture, table and notes while keeping the other slide parts byte-identical", async ({
  page,
  request
}, info) => {
  test.slow();
  const title = `Визуальная проверка ${crypto.randomUUID()}`;
  const created = await request.post("/api/v1/presentations/import", {
    data: {
      format: "kosmora-presentation-v1",
      title,
      theme: "paper",
      slides: ["Первый слайд", "Таблица", "Изображение"].map((name, index) => ({
        id: `fixture-${index}`,
        title: name,
        body: "Исходный текст",
        layout: "content",
        aside: "",
        notes: ""
      }))
    }
  });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };
  await page.goto("/presentations");
  await page.getByRole("button", { name: new RegExp(title) }).click();
  const editor = page.getByRole("region", { name: "Редактор презентации", exact: true });
  const visual = editor.getByRole("region", { name: "Изображение или таблица слайда" });
  const save = page.getByRole("button", { name: "Сохранить", exact: true });
  const first = await downloadSlides(page);
  await editor
    .getByRole("button", { name: /Таблица/ })
    .first()
    .click();
  await visual.getByRole("button", { name: "Добавить таблицу" }).click();
  await visual.getByLabel("Строка 1, столбец 1").fill("Артикул");
  await visual.getByLabel("Строка 1, столбец 2").fill("Сумма");
  await visual.getByLabel("Строка 2, столбец 1").fill("00123");
  await visual.getByLabel("Строка 2, столбец 2").fill("19 700 & НДС");
  await editor.getByLabel("Заметки докладчика").fill("кроме доставки");
  const table = editor.getByRole("table", { name: "Таблица на слайде" });
  await expect(table.getByText("00123", { exact: true })).toBeVisible();
  await table.screenshot({ path: info.outputPath("studio-presentation-table.png") });
  await save.click();
  await expect(save).toBeDisabled();
  await editor
    .getByRole("button", { name: /Изображение/ })
    .first()
    .click();
  await visual.getByLabel(/Добавить изображение/).setInputFiles({
    name: "fixture.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>")
  });
  await expect(visual.getByRole("alert")).toHaveText("Выберите фото PNG/JPEG.");
  await visual.getByLabel(/Добавить изображение/).setInputFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: await readFile(imageFile)
  });
  await visual.getByLabel("Описание изображения").fill("Проверочная цветная шкала");
  const image = editor.getByRole("img", { name: "Проверочная цветная шкала" });
  await expect
    .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBe(192);
  await image.screenshot({ path: info.outputPath("studio-presentation-picture.png") });
  await save.click();
  await expect(save).toBeDisabled();
  const persisted = await request.get(`/api/v1/presentations/${id}`);
  expect(persisted.status()).toBe(200);
  expect(await persisted.json()).toMatchObject({ version: 3 });
  const after = await downloadSlides(page, info.outputPath("studio-presentation.pptx"));
  expect(after["ppt/slides/slide1.xml"]).toEqual(first["ppt/slides/slide1.xml"]);
  expect(after["ppt/notesSlides/notesSlide1.xml"]).toEqual(
    first["ppt/notesSlides/notesSlide1.xml"]
  );
  expect(strFromU8(after["ppt/slides/slide2.xml"]!)).toContain("<a:tbl>");
  expect(strFromU8(after["ppt/slides/slide2.xml"]!)).toContain("19 700 &amp; НДС");
  expect(strFromU8(after["ppt/notesSlides/notesSlide2.xml"]!)).toContain("кроме доставки");
  expect(strFromU8(after["ppt/slides/slide3.xml"]!)).toContain("<p:pic>");
  expect(strFromU8(after["ppt/slides/_rels/slide3.xml.rels"]!)).toContain("../media/image3.png");
  expect(Buffer.from(after["ppt/media/image3.png"]!)).toEqual(await readFile(imageFile));
  await page.reload();
  await page.getByRole("button", { name: new RegExp(title) }).click();
  await editor
    .getByRole("button", { name: /Таблица/ })
    .first()
    .click();
  await expect(visual.getByLabel("Строка 2, столбец 1")).toHaveValue("00123");
  await editor
    .getByRole("button", { name: /Изображение/ })
    .first()
    .click();
  await expect(visual.getByLabel("Описание изображения")).toHaveValue("Проверочная цветная шкала");
});
