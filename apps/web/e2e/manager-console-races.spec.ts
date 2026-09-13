import { expect, test, type Page } from "@playwright/test";

const project = (id: string) => ({
  id,
  title: id === "alpha" ? "Project Alpha" : "Project Beta",
  status: "ACTIVE",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z"
});

const message = (
  id: string,
  role: "user" | "assistant",
  content: string,
  status = "completed"
) => ({
  id: `${id}-${role}`,
  project_id: id,
  chat_id: `${id}-chat`,
  role,
  content_type: "text",
  content,
  status,
  reply_to_message_id: null,
  run_id: `${id}-run`,
  error_code: status === "failed" ? "PROVIDER_ERROR" : null,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z"
});

const detail = (id: string, content = "Ответ", status = "completed") => ({
  project: project(id),
  chat_id: `${id}-chat`,
  messages: [message(id, "user", `Запрос ${id}`), message(id, "assistant", content, status)]
});

const fixture = async (page: Page) => {
  const state = {
    alpha: detail("alpha"),
    waitForAlpha: Promise.resolve(),
    unavailablePolicy: false,
    failProjectList: false,
    posts: 0
  };
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (route.request().method() === "POST") {
      state.posts += 1;
      state.failProjectList = true;
      body = {
        project: project("alpha"),
        chat_id: "alpha-chat",
        user_message: message("alpha", "user", "Новая задача"),
        run_id: "alpha-run",
        stream_url: "/api/v1/runs/alpha-run/events"
      };
    } else if (path === "/api/v1/projects") {
      if (state.failProjectList) return route.fulfill({ status: 503, body: "{}" });
      body = { items: [project("alpha"), project("beta")] };
    } else if (path === "/api/v1/model-runtime") {
      body = { mode: "mock", provider: "mock", model: "fixture", fallback_to_mock: false };
    } else if (path === "/api/v1/projects/alpha") {
      const snapshot = structuredClone(state.alpha);
      await state.waitForAlpha;
      body = snapshot;
    } else if (path === "/api/v1/projects/beta") {
      body = detail("beta");
    } else if (path.endsWith("/autonomy-profile")) {
      body = { profile: { base_level: "A0", version: 1 } };
    } else {
      if (state.unavailablePolicy) return route.fulfill({ status: 503, body: "{}" });
      body = { items: [] };
    }
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
  // Deterministically deliver observer events around persisted-state reads.
  // The real coordinator/HTTP/SSE path remains covered by b0.1.spec.ts.
  await page.addInitScript(() => {
    class FixtureEventSource extends EventTarget {
      onerror: (() => void) | null = null;
      readonly receive = (event: Event): void => {
        const { type, data } = (event as CustomEvent<{ type: string; data: unknown }>).detail;
        this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify({ data }) }));
      };
      constructor() {
        super();
        window.addEventListener("fixture:sse", this.receive);
        document.documentElement.dataset.observer = "open";
      }
      close(): void {
        window.removeEventListener("fixture:sse", this.receive);
        document.documentElement.dataset.observer = "closed";
      }
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEventSource });
  });
  return state;
};

for (const destination of ["beta", "new"] as const) {
  test(`ignores a delayed old project response after switching to ${destination}`, async ({
    page
  }) => {
    const state = await fixture(page);
    let release!: () => void;
    state.waitForAlpha = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.goto("/");
    const oldRequest = page.waitForRequest("**/api/v1/projects/alpha");
    await page
      .locator(".project-list")
      .getByRole("button", { name: /Project Alpha/ })
      .click();
    await oldRequest;
    if (destination === "beta") {
      await page
        .locator(".project-list")
        .getByRole("button", { name: /Project Beta/ })
        .click();
    } else {
      await page.getByRole("button", { name: "＋ Новый проект", exact: true }).click();
    }
    const heading = destination === "beta" ? "Project Beta" : "Cosmora Control Center";
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    const oldResponse = page.waitForResponse("**/api/v1/projects/alpha");
    release();
    await oldResponse;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    );
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (destination === "beta") {
      await expect(page.locator(".message.user p")).toHaveText("Запрос beta");
    } else {
      await expect(page.locator(".chat-panel")).toHaveCount(0);
    }
  });
}

test("does not append a streamed delta twice when polling already contains it", async ({
  page
}) => {
  const state = await fixture(page);
  state.alpha = detail("alpha", "A", "streaming");
  await page.goto("/");
  await page
    .locator(".project-list")
    .getByRole("button", { name: /Project Alpha/ })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-observer", "open");
  const emit = (seq: number, delta: string) =>
    page.evaluate(
      ({ seq, delta }) => {
        window.dispatchEvent(
          new CustomEvent("fixture:sse", {
            detail: { type: "message.delta", data: { message_id: "alpha-assistant", seq, delta } }
          })
        );
      },
      { seq, delta }
    );
  await emit(0, "A");
  state.alpha = detail("alpha", "AB", "streaming");
  await expect(page.locator(".message.assistant p")).toHaveText("AB");
  await emit(1, "B");
  await expect(page.locator(".message.assistant p")).toHaveText("AB");
  await expect(page.getByRole("button", { name: "Остановить" })).toBeEnabled();
});

test("preserves an accepted run when only the sidebar refresh fails", async ({ page }) => {
  const state = await fixture(page);
  state.alpha = detail("alpha", "", "streaming");
  await page.goto("/");
  await page.getByLabel("Опишите результат, который хотите получить").fill("Новая задача");
  await page.getByRole("button", { name: "Запустить", exact: true }).click();
  await expect(page.getByText("Запуск принят. Не удалось обновить список проектов.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Остановить" })).toBeEnabled();
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("");
  expect(state.posts).toBe(1);
});

test("shows unavailable policy reads as unknown instead of empty queues", async ({ page }) => {
  const state = await fixture(page);
  state.unavailablePolicy = true;
  await page.goto("/");
  await page
    .locator(".project-list")
    .getByRole("button", { name: /Project Alpha/ })
    .click();
  await page.getByRole("tab", { name: "Проект" }).click();
  const facts = page.getByRole("region", { name: "Информация о проекте" });
  await expect(facts.getByText("Нет данных", { exact: true })).toHaveCount(2);
  await expect(facts.getByText("Не требуется", { exact: true })).toHaveCount(0);
});

test("restores a failed request without submitting it", async ({ page }) => {
  const state = await fixture(page);
  state.alpha = detail("alpha", "Partial response", "failed");
  await page.goto("/");
  await page
    .locator(".project-list")
    .getByRole("button", { name: /Project Alpha/ })
    .click();
  await page.getByRole("button", { name: "Вернуть запрос в редактор" }).click();
  await expect(page.getByLabel("Сообщение менеджеру")).toHaveValue("Запрос alpha");
  await expect(page.getByLabel("Сообщение менеджеру")).toBeFocused();
  expect(state.posts).toBe(0);
});
