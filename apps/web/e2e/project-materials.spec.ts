import { expect, test } from "@playwright/test";

test("stores actual project materials, reloads them and preserves edits on version conflict", async ({
  page,
  request
}) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: { initial_message: "Материалы проекта", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  await page.goto(`/?project=${project.id}&view=context`);
  await page.getByLabel("Требования к проекту").fill("Пиши ответы по-русски.");
  await page
    .getByRole("tabpanel", { name: "Контекст проекта" })
    .getByLabel("Текстовые файлы и код")
    .setInputFiles({
      name: "requirements.md",
      mimeType: "text/plain",
      buffer: Buffer.from("Нужно сохранять историю")
    });
  await page.getByRole("button", { name: "Сохранить материалы", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Материалы сохранены" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Пиши ответы по-русски.");
  await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
    "requirements.md"
  );
  const saved = await request.get(`http://127.0.0.1:3100/api/v1/projects/${project.id}/materials`);
  const value = (await saved.json()) as { version: number };
  await request.put(`http://127.0.0.1:3100/api/v1/projects/${project.id}/materials`, {
    data: { version: value.version, instructions: "Другой редактор", attachments: [] }
  });
  await page.getByLabel("Требования к проекту").fill("Мой несохранённый черновик");
  await page.getByRole("button", { name: "Сохранить материалы", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Контекст проекта" }).getByRole("alert")
  ).toContainText("другом окне");
  await expect(page.getByLabel("Требования к проекту")).toHaveValue("Мой несохранённый черновик");
});
