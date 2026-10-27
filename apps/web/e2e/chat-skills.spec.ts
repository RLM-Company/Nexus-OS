import { randomUUID } from "node:crypto";
import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
const api = "http://127.0.0.1:3100";
async function setup(page: Page, request: APIRequestContext) {
  const skillResponse = await request.post(`${api}/api/v1/owner-skills`, {
    data: {
      name: `Историк ${randomUUID().slice(0, 8)}`,
      summary: "Проверять источники",
      instructions: "<script>window.skillInjected=true</script> Сравнивай источники."
    }
  });
  expect(skillResponse.status()).toBe(201);
  const skill = (await skillResponse.json()) as { id: string; name: string };
  const response = await request.post(`${api}/api/v1/chats`, {
    data: { initial_message: "Проверка Skills", client_message_id: randomUUID() }
  });
  const accepted = (await response.json()) as { chat: { id: string }; stream_url: string };
  await request.get(`${api}${accepted.stream_url}`);
  await page.goto(`/?chat=${accepted.chat.id}`);
  await expect(page.locator(".topbar h1")).toHaveText("Проверка Skills");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const panel = page.getByRole("group", { name: "Skills чата", exact: true });
  const choice = panel.getByRole("checkbox", { name: new RegExp(skill.name) });
  await expect(choice).toBeEnabled();
  return { panel, choice, skill, path: `/api/v1/chats/${accepted.chat.id}/skills` };
}
test("selects, persists, explicitly upgrades and disables Skills; renders instructions literally", async ({
  page,
  request
}) => {
  const { panel, choice, skill, path } = await setup(page, request);
  await choice.check();
  await panel.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Skills сохранены.");
  expect((await (await request.get(`${api}${path}`)).json()).selection.items[0]).toMatchObject({
    skill_id: skill.id,
    version: 1
  });
  await request.put(`${api}/api/v1/owner-skills/${skill.id}`, {
    data: {
      expected_version: 1,
      name: skill.name,
      summary: "Проверять источники",
      instructions: "Новые инструкции v2"
    }
  });
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Проверка Skills");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await expect(choice).toBeChecked();
  await expect(panel.getByText("Выбрана v1 · доступна v2", { exact: true })).toBeVisible();
  await panel.getByText("Подключённые инструкции", { exact: true }).click();
  await expect(panel.locator("pre")).toContainText("<script>");
  expect(await page.evaluate(() => Object.hasOwn(window, "skillInjected"))).toBe(false);
  await panel.getByRole("button", { name: `Обновить ${skill.name} до v2`, exact: true }).click();
  await panel.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Skills сохранены.");
  await panel.getByRole("button", { name: "Отключить все Skills", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Skills отключены.");
  await expect(choice).not.toBeChecked();
});
test("preserves a local selection on conflict and reloads current state", async ({
  page,
  request
}) => {
  const { panel, choice, path } = await setup(page, request);
  await choice.check();
  expect(
    (await request.put(`${api}${path}`, { data: { expected_version: 0, items: [] } })).status()
  ).toBe(200);
  await panel.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("другой вкладке");
  await expect(choice).toBeChecked();
  await panel.getByRole("button", { name: "Загрузить сохранённый выбор", exact: true }).click();
  await expect(choice).not.toBeChecked();
});
test("recovers a lost save response with one PUT", async ({ page, request }) => {
  const { panel, choice, path } = await setup(page, request);
  let writes = 0;
  await page.route(`**${path}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    writes++;
    await route.fetch();
    await route.abort("failed");
  });
  await choice.check();
  await panel.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Skills сохранены.");
  expect(writes).toBe(1);
});
test("keeps the Skills controls within a narrow screen", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { panel, choice } = await setup(page, request);
  await choice.check();
  await panel.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Skills сохранены.");
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("chat-skills-mobile.png") });
});

test("retains the accepted Skill snapshot through the API without adding answer controls or generating", async ({
  page,
  request
}) => {
  const { choice, panel, skill, path } = await setup(page, request);
  await choice.check();
  await panel.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Skills сохранены.");
  const chatId = path.split("/").at(-2)!;
  const next = await request.post(`${api}/api/v1/chats/${chatId}/messages`, {
    data: { content: "Проверка снимка", client_message_id: randomUUID() }
  });
  expect(next.status()).toBe(202);
  const accepted = (await next.json()) as { stream_url: string; run_id: string };
  await request.get(`${api}${accepted.stream_url}`);
  expect(
    (
      await request.delete(`${api}/api/v1/owner-skills/${skill.id}`, {
        data: { expected_version: 1 }
      })
    ).status()
  ).toBe(204);
  const before = await (await request.get(`${api}/api/v1/chats/${chatId}`)).json();
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname.includes(`/chats/${chatId}/messages`))
      writes.push(r.url());
  });
  await page.reload();
  await expect(page.locator(".message")).toHaveCount(before.messages.length);
  await expect(page.getByLabel("Skills этого ответа", { exact: true })).toHaveCount(0);
  for (let read = 0; read < 2; read++) {
    const response = await request.get(`${api}/api/v1/chat-runs/${accepted.run_id}/skills`);
    expect(response.ok()).toBeTruthy();
    expect((await response.json()).snapshot.items).toEqual([
      expect.objectContaining({
        skill_id: skill.id,
        version: 1,
        instructions: "<script>window.skillInjected=true</script> Сравнивай источники."
      })
    ]);
  }
  expect(await page.evaluate(() => Object.hasOwn(window, "skillInjected"))).toBe(false);
  expect((await (await request.get(`${api}/api/v1/chats/${chatId}`)).json()).messages).toEqual(
    before.messages
  );
  expect(writes).toEqual([]);
});
