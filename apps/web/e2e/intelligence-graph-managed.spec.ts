import { expect, test } from "@playwright/test";

test("creates and reopens a graph through the real managed API and SQLite", async ({
  page,
  request
}) => {
  const response = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: { initial_message: "Graph integration fixture", client_message_id: crypto.randomUUID() }
  });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string } };
  await page.goto(`/graph-workspace?projectId=${project.id}`);
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Название нового графа", exact: true })
    .fill("Проверенная база знаний");
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/intelligence-graphs")
  );
  await page.getByRole("button", { name: "Создать пустой граф", exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(
    page.getByRole("button", { name: "Проверенная база знаний · v1", exact: true })
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page.getByRole("button", { name: "Проверенная база знаний · v1", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Добавить узел", exact: true })).toBeVisible();
  const stored = await request.get(
    `http://127.0.0.1:3100/api/v1/projects/${project.id}/intelligence-graphs`
  );
  expect(stored.status()).toBe(200);
  expect((await stored.json()).items).toHaveLength(1);
});
