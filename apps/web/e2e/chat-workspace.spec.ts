import { test, expect, type APIRequestContext } from "@playwright/test";

async function seed(request: APIRequestContext, content = "Папки и контекст Kosmora") {
  const response = await request.post("/api/v1/chats", {
    data: { initial_message: content, client_message_id: crypto.randomUUID() }
  });
  expect(response.ok()).toBeTruthy();
  const chat = await response.json();
  expect((await request.get(chat.stream_url)).ok()).toBeTruthy();
  return chat;
}
test("legacy folders stay hidden while server pins persist and folder removal keeps chats", async ({
  page,
  request,
  browser
}) => {
  const accepted = await seed(request);
  const id = crypto.randomUUID();
  expect(
    (
      await request.put(`/api/v1/chat-navigation/folders/${id}`, {
        data: { title: "Рабочие задачи" }
      })
    ).ok()
  ).toBeTruthy();
  expect(
    (
      await request.put(`/api/v1/chats/${accepted.chat.id}/folder`, {
        data: { folder_id: id }
      })
    ).ok()
  ).toBeTruthy();
  await page.goto(`/?chat=${accepted.chat.id}`);
  await expect(page.getByText("Папки чатов", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Папка текущего чата", { exact: true })).toHaveCount(0);
  const pin = page.getByRole("button", { name: "Закрепить чат", exact: true }).last();
  await pin.click();
  await expect
    .poll(async () =>
      (await (await request.get("/api/v1/chat-navigation")).json()).chats.includes(accepted.chat.id)
    )
    .toBe(true);
  const other = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  try {
    const second = await other.newPage();
    await second.goto(`/?chat=${accepted.chat.id}`);
    await expect(second.getByText("Папки чатов", { exact: true })).toHaveCount(0);
    const nav = await (await other.request.get("/api/v1/chat-navigation")).json();
    expect(nav.folders).toContainEqual(expect.objectContaining({ id, title: "Рабочие задачи" }));
    expect(nav.assignments).toContainEqual(
      expect.objectContaining({ chat_id: accepted.chat.id, folder_id: id })
    );
    await expect(
      second.getByRole("button", { name: "Открепить чат", exact: true }).last()
    ).toBeVisible();
  } finally {
    await other.close();
  }
  expect((await request.delete(`/api/v1/chat-navigation/folders/${id}`)).ok()).toBeTruthy();
  const remaining = await (await request.get("/api/v1/chat-navigation")).json();
  expect(remaining.folders.some((folder: { id: string }) => folder.id === id)).toBe(false);
  expect(remaining.assignments.some((a: { folder_id: string }) => a.folder_id === id)).toBe(false);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Открепить чат", exact: true }).last()
  ).toBeVisible();
  expect((await request.get(`/api/v1/chats/${accepted.chat.id}`)).ok()).toBeTruthy();
});
test("exclusions are explicitly saved and restored without deleting original messages", async ({
  page,
  request
}) => {
  const accepted = await seed(request, "Контекст: сохраняемый важный факт");
  await page.goto(`/?chat=${accepted.chat.id}`);
  await page.getByRole("button", { name: "Контекст переписки", exact: true }).click();
  const panel = page.getByRole("region", { name: "Контекст переписки", exact: true });
  const box = panel.getByRole("checkbox").first();
  await expect(box).toBeEnabled();
  await box.uncheck();
  await panel.getByRole("button", { name: "Сохранить контекст", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Контекст сохранён");
  await page.reload();
  await page.getByRole("button", { name: "Контекст переписки", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Контекст переписки", exact: true })
      .getByRole("checkbox")
      .first()
  ).not.toBeChecked();
  expect(
    (await (await request.get(`/api/v1/chats/${accepted.chat.id}`)).json()).messages
  ).toHaveLength(2);
});
test("ordinary chat answer transfers into project Canvas once and survives reload", async ({
  page,
  request
}) => {
  const accepted = await seed(request, "Черновик спецификации для Canvas");
  const project = await (
    await request.post("/api/v1/projects/empty", {
      data: { title: "Canvas bridge", client_project_id: crypto.randomUUID() }
    })
  ).json();
  const id = project.project.id;
  await page.goto(`/?chat=${accepted.chat.id}`);
  await page.getByRole("button", { name: "В Canvas", exact: true }).first().click();
  await page.getByLabel("Проект для Canvas", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: "Сохранить ответ в Canvas", exact: true }).click();
  await expect(page.getByText("Ответ сохранён в Canvas проекта.", { exact: true })).toBeVisible();
  const list = await (await request.get(`/api/v1/projects/${id}/canvas`)).json();
  expect(list.items).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: "В Canvas", exact: true }).first().click();
  await page.getByLabel("Проект для Canvas", { exact: true }).selectOption(id);
  await page.getByRole("button", { name: "Сохранить ответ в Canvas", exact: true }).click();
  await expect(page.getByText("Ответ сохранён в Canvas проекта.", { exact: true })).toBeVisible();
  expect((await (await request.get(`/api/v1/projects/${id}/canvas`)).json()).items).toHaveLength(1);
});

test("extractive summary is reviewed, edited, explicitly saved and restored", async ({
  page,
  request
}) => {
  test.setTimeout(90000);
  const accepted = await seed(request, "Ранний факт для сводки");
  for (let i = 0; i < 4; i++) {
    const next = await (
      await request.post(`/api/v1/chats/${accepted.chat.id}/messages`, {
        data: { content: `Продолжение ${i}`, client_message_id: crypto.randomUUID() }
      })
    ).json();
    await request.get(next.stream_url);
  }
  await page.goto(`/?chat=${accepted.chat.id}`);
  await page.getByRole("button", { name: "Контекст переписки", exact: true }).click();
  await page.getByRole("button", { name: "Подготовить выдержку", exact: true }).click();
  const field = page.getByLabel("Сводка ранней истории", { exact: true });
  await expect(field).toHaveValue(/Ранний факт/);
  await field.fill("Проверенная пользователем сводка.");
  await page.getByRole("button", { name: "Сохранить контекст", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Контекст переписки", exact: true }).getByRole("status")
  ).toContainText("Контекст сохранён");
  await page.reload();
  await page.getByRole("button", { name: "Контекст переписки", exact: true }).click();
  await expect(page.getByLabel("Сводка ранней истории", { exact: true })).toHaveValue(
    "Проверенная пользователем сводка."
  );
});
