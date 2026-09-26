import { expect, test } from "@playwright/test";

test("reports an interrupted general chat stream without exposing transport details", async ({
  page
}) => {
  await page.addInitScript(() => {
    class InterruptingEventSource extends EventTarget {
      onerror: ((event: Event) => void) | null = null;

      constructor() {
        super();
        window.setTimeout(() => this.onerror?.(new Event("error")), 0);
      }

      close(): void {
        document.documentElement.dataset.streamClosed = "true";
      }
    }

    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: InterruptingEventSource
    });
  });

  await page.route("**/api/v1/chats", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    const now = "2026-09-22T20:00:00.000Z";
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        chat: {
          id: "interrupted-chat",
          title: "Interrupted chat",
          created_at: now,
          updated_at: now
        },
        user_message: {
          id: "interrupted-message",
          chat_id: "interrupted-chat",
          role: "user",
          content_type: "text",
          content: "Проверь обрыв потока",
          status: "completed",
          run_id: "interrupted-run",
          error_code: null,
          created_at: now,
          updated_at: now
        },
        run_id: "interrupted-run",
        stream_url: "/api/v1/chat-runs/interrupted-run/events"
      })
    });
  });

  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Проверь обрыв потока");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();

  await expect(
    page.getByRole("alert").filter({
      hasText: "Поток ответа прерван. Проверяю сохранённое состояние на сервере."
    })
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-stream-closed", "true");
  await expect(page.locator("body")).not.toContainText("EventSource");
  await expect(page.locator("body")).not.toContainText("interrupted-run");
});
