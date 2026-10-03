import { expect, test } from "@playwright/test";

test("restores an unsent ordinary-chat draft after reload", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByLabel("Сообщение Cosmora");
  await composer.fill("Черновик, который должен пережить перезапуск");
  await page.reload();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue(
    "Черновик, который должен пережить перезапуск"
  );
});

test("restores an unsent project draft after reload", async ({ page, request }) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Проект для проверки сохранения черновика",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };

  await page.goto(`/?project=${project.id}&view=chat`);
  const composer = page.getByLabel("Сообщение менеджеру");
  await composer.fill("Несохранённое уточнение проекта");
  await page.reload();
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue(
    "Несохранённое уточнение проекта"
  );
});
