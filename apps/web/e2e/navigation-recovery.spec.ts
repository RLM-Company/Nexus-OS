import { expect, test } from "@playwright/test";

test("malformed navigation cannot crash the chat and a valid refresh restores pin controls", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/chats", {
    data: {
      initial_message: "Сохранить рабочий чат при сбое навигации",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.ok()).toBeTruthy();
  const accepted = await created.json();
  await request.get(accepted.stream_url);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let invalidReads = 0;
  const bad = async (route: import("@playwright/test").Route) => {
    invalidReads++;
    await route.fulfill({ json: { items: [] } });
  };
  await page.route("**/api/v1/chat-navigation", bad);
  await page.route("**/api/v1/chat-navigation/import-pins", bad);
  await page.goto(`/?chat=${accepted.chat.id}`);
  const composer = page.getByLabel("Сообщение Kosmora", { exact: true });
  await expect(composer).toBeEnabled();
  await expect.poll(() => invalidReads).toBeGreaterThanOrEqual(2);
  await expect(page.locator(".topbar h1")).toHaveText("Сохранить рабочий чат при сбое навигации");
  await composer.fill("Мой несохранённый черновик");
  const pin = page.getByRole("button", { name: "Закрепить чат", exact: true }).last();
  await expect(pin).toBeDisabled();
  await page.route("**/api/v1/chat-navigation", (route) =>
    route.fulfill({
      json: {
        folders: [],
        assignments: [],
        chats: [],
        projects: []
      }
    })
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(pin).toBeEnabled();
  await expect(composer).toHaveValue("Мой несохранённый черновик");
  expect(errors).toEqual([]);
});
