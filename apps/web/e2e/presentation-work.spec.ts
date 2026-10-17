import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { strFromU8, unzipSync } from "fflate";

test("generates a durable presentation through Work, reviews it and exports editable PPTX without duplicate import", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Presentation fixture", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  expect(
    (
      await request.put(`/api/v1/projects/${project.id}/autonomy-profile`, {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).status()
  ).toBe(200);
  await page.goto("/presentations");
  await page.getByText("Создать презентацию с ИИ", { exact: true }).click();
  await page.getByLabel("Проект для презентации").selectOption(project.id);
  await page.getByLabel("Тема и требования").fill("E2E_PRESENTATION_WORK: законы Ньютона");
  await page.getByLabel("Количество слайдов").selectOption("3");
  await page.getByLabel("Разрешаю до трёх запросов", { exact: false }).check();
  await page.getByRole("button", { name: "Создать слайды", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Проверить слайды из presentation.json", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Проверить слайды из presentation.json", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Открыть в редакторе", exact: true })
  ).toBeDisabled();
  await expect(page.getByText("Проверка слайдов · 3 слайдов", { exact: true })).toBeVisible();
  await page.getByLabel("Проверил все слайды и заметки", { exact: false }).check();
  await page.route("**/api/v1/presentations/from-work", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort("failed");
    await page.unroute("**/api/v1/presentations/from-work");
  });
  await page.getByRole("button", { name: "Открыть в редакторе", exact: true }).click();
  await expect(page.getByRole("alert").last()).toBeVisible();
  await page.getByRole("button", { name: "Открыть в редакторе", exact: true }).click();
  const editor = page.getByRole("region", { name: "Редактор презентации", exact: true });
  await expect(editor.getByLabel("Заголовок", { exact: true })).toHaveValue("Законы Ньютона");
  await expect(editor.getByText(/Источник: Work/)).toBeVisible();
  const list = await request.get("/api/v1/presentations");
  const decks = ((await list.json()) as { items: { title: string }[] }).items.filter(
    (item) => item.title === "Проверка слайдов"
  );
  expect(decks).toHaveLength(1);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Скачать PPTX", exact: true }).click();
  const zip = unzipSync(new Uint8Array(await readFile((await (await download).path())!)));
  expect(strFromU8(zip["ppt/slides/slide1.xml"]!)).toContain("Законы Ньютона");
  expect(strFromU8(zip["ppt/notesSlides/notesSlide1.xml"]!)).toContain(
    "Заметки &amp; &lt;текст&gt;"
  );
  await page.reload();
  await page
    .getByRole("button", { name: /Проверка слайдов/ })
    .first()
    .click();
  await expect(editor.getByLabel("Заголовок", { exact: true })).toHaveValue("Законы Ньютона");
  const works = (
    (await (await request.get(`/api/v1/projects/${project.id}/work`)).json()) as {
      items: { model_requests: number }[];
    }
  ).items;
  expect(works).toHaveLength(1);
  expect(works[0]!.model_requests).toBe(3);
});
