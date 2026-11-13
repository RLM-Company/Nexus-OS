import { expect, test } from "@playwright/test";

for (const status of ["cancelled", "failed", "completed"] as const) {
  test(`a ${status} run without an assistant does not reopen from stale history`, async ({
    page,
    request
  }) => {
    const created = await request.post("/api/v1/chats", {
      data: {
        initial_message: `Terminal history fixture: ${status}`,
        client_message_id: crypto.randomUUID()
      }
    });
    expect(created.status()).toBe(201);
    const accepted = (await created.json()) as {
      chat: { id: string };
      user_message: { run_id: string };
      run_id: string;
    };
    const detail = await request.get(`/api/v1/chats/${accepted.chat.id}`);
    const history = (await detail.json()) as { messages: { role: string }[] };
    history.messages = history.messages.filter((message) => message.role === "user");
    // The terminal event is authoritative; history can lag it or never contain an
    // assistant when the run was cancelled before generation started.
    await page.route(`**/api/v1/chats/${accepted.chat.id}`, (route) =>
      route.fulfill({ json: history })
    );
    let observers = 0;
    await page.route(`**/api/v1/chat-runs/${accepted.run_id}/events`, (route) => {
      observers += 1;
      const type = `run.${status}`;
      return route.fulfill({
        contentType: "text/event-stream",
        body: `event: ${type}\ndata: ${JSON.stringify({
          type,
          data: {
            run_id: accepted.run_id,
            error_code: "INTERRUPTED",
            provider: "fixture",
            model_resolved: "fixture"
          }
        })}\n\n`
      });
    });
    await page.goto(`/?chat=${accepted.chat.id}`);
    await expect.poll(() => observers).toBeGreaterThan(0);
    // Observe longer than the old immediate terminal/history/reconnect loop.
    await page.waitForTimeout(500);
    expect(observers).toBe(1);
    const editor = page.getByRole("textbox", { name: "Сообщение Kosmora" });
    await expect(editor).toBeEnabled();
    const text = "19 700 ₽; артикул 00123; 13.11.2026; кроме доставки";
    await editor.fill(text);
    await page.getByLabel("Текстовые файлы и код").setInputFiles({
      name: "terminal.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(text)
    });
    await expect(editor).toHaveValue(text);
    await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
      "terminal.txt"
    );
    await page.reload();
    await expect(editor).toHaveValue(text);
    await expect(page.getByRole("list", { name: "Прикреплённые файлы" })).toContainText(
      "terminal.txt"
    );
    await page.waitForTimeout(500);
    expect(observers).toBe(2);
    await expect(editor).toBeEnabled();
  });
}
