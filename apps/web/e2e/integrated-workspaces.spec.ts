import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test("presentation editing persists and downloads an actual editable PPTX", async ({ page }) => {
  await page.goto("/presentations");
  await page.getByRole("textbox", { name: "Название", exact: true }).fill("Демонстрация Kosmora");
  await page.getByRole("button", { name: "+ Создать", exact: true }).click();
  const editor = page.getByRole("region", { name: "Редактор презентации", exact: true });
  await expect(editor).toBeVisible();
  const title = editor.getByRole("textbox", { name: "Заголовок", exact: true });
  await title.fill("Готовый редактируемый слайд");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("button", { name: "Сохранить", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: /Демонстрация Kosmora/ }).click();
  await expect(title).toHaveValue("Готовый редактируемый слайд");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PPTX", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pptx$/);
  const zip = unzipSync(new Uint8Array(await readFile((await file.path())!)));
  expect(strFromU8(zip["ppt/slides/slide1.xml"]!)).toContain("Готовый редактируемый слайд");
  expect(strFromU8(zip["[Content_Types].xml"]!)).toContain("presentationml");
});

test("private Skills save versions and export an inert reusable package", async ({ page }) => {
  await page.goto("/skills");
  const editor = page.getByRole("region", { name: "Редактор Skill", exact: true });
  await expect(
    editor.getByRole("button", { name: "Сохранить версию", exact: true })
  ).toBeDisabled();
  await expect(editor.getByRole("textbox", { name: "Название", exact: true })).toBeEnabled();
  await editor.getByRole("textbox", { name: "Название", exact: true }).fill("Проверка TypeScript");
  await editor
    .getByRole("textbox", { name: "Краткое описание", exact: true })
    .fill("Проверить код и объяснить замечания");
  await editor
    .getByRole("textbox", { name: "Инструкция", exact: true })
    .fill("Проверь типы, обработку ошибок и понятность кода.");
  await expect(editor.getByRole("button", { name: "Сохранить версию", exact: true })).toBeEnabled();
  await editor.getByRole("button", { name: "Сохранить версию", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "Скачать сохранённый пакет", exact: true })
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Скачать сохранённый пакет", exact: true }).click();
  const file = await download;
  const data = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(data).toMatchObject({
    format: "kosmora.skill.v1",
    name: "Проверка TypeScript",
    execution: "disabled",
    permissions: []
  });
  await page.reload();
  await page.getByRole("button", { name: /Проверка TypeScript/ }).click();
  await expect(editor.getByRole("textbox", { name: "Инструкция", exact: true })).toHaveValue(
    data.instructions
  );
});
