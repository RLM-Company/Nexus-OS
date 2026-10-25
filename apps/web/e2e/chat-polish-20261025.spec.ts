import { expect, test } from "@playwright/test";
test("branded profiles, autonomy and Turbo are persisted without starting a model", async ({
  page,
  request
}) => {
  await page.goto("/");
  const picker = page.locator("[data-model-picker]");
  await expect(picker.locator("summary")).toHaveAttribute("aria-disabled", "false");
  await picker.locator("summary").click();
  await expect(picker).toHaveJSProperty("open", true);
  await expect(page.getByRole("textbox", { name: "Найти модель" })).toHaveCount(0);
  await page.getByRole("button", { name: /Kosmora Jupiter/ }).click();
  await expect(picker.locator("summary")).toContainText("Kosmora Jupiter");
  const autonomy = page.getByRole("slider", { name: "Уровень автономности" });
  await autonomy.focus();
  await autonomy.press("End");
  await expect
    .poll(
      async () => (await (await request.get("/api/v1/personal-settings")).json()).execution.autonomy
    )
    .toBe(6);
  await page.getByRole("button", { name: "Мегабыстрый режим", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Мегабыстрый режим", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(picker.locator("summary")).toContainText("Kosmora Jupiter");
  await expect(
    page.getByRole("button", { name: "Мегабыстрый режим", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await expect(picker.locator("summary")).not.toContainText(/gpt|cheapvibecode/i);
});
test("sidebar fully collapses, survives reload and restores its layout", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Свернуть боковую панель", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeHidden();
  expect(
    await page.locator(".workspace").evaluate((e) => Math.round(e.getBoundingClientRect().left))
  ).toBe(0);
  await page.reload();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.getByRole("button", { name: "Развернуть боковую панель", exact: true }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});
test("answer actions are icons in one row and quick table prepares an editable request", async ({
  page,
  request
}) => {
  const response = await request.post("/api/v1/chats", {
    data: { initial_message: "Покажи короткий ответ", client_message_id: crypto.randomUUID() }
  });
  const accepted = await response.json();
  await request.get(accepted.stream_url);
  await page.goto(`/?chat=${accepted.chat.id}`);
  const answer = page.locator(".message.assistant").last();
  await expect(answer.locator(".response-actions")).toBeVisible();
  await expect(answer.locator(".message-avatar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Скачать ответ", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Контекст переписки", exact: true })).toHaveCount(
    0
  );
  await expect(page.getByRole("button", { name: "Вставить в сообщение", exact: true })).toHaveCount(
    0
  );
  const labels = ["Копировать ответ", "Озвучить ответ", "В Canvas", "Повторить ответ"];
  const centers = [];
  for (const name of labels) {
    const control = answer.getByRole("button", { name, exact: true });
    await expect(control.locator("svg")).toHaveCount(1);
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    centers.push(box!.y + box!.height / 2);
  }
  expect(Math.max(...centers) - Math.min(...centers)).toBeLessThan(2);
  await answer.getByRole("button", { name: /В таблицу/ }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue(/сравнительную таблицу/);
  await page.screenshot({ path: "../../qa/chat-actions-20261025.png", fullPage: true });
});
test("settings can disable the token quota and persist actual interface preferences", async ({
  page,
  request
}) => {
  await page.goto("/personal-settings");
  await expect(page.getByRole("heading", { name: "Настройки", exact: true })).toBeVisible();
  const quota = page.getByRole("switch", { name: "Персональное ограничение расхода токенов" });
  await quota.check();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/personal-settings")).json()).settings.max_total_tokens
    )
    .toBe(200000);
  await quota.uncheck();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/v1/personal-settings")).json()).settings.max_total_tokens
    )
    .toBeNull();
  await page.getByRole("switch", { name: "Увеличенный текст", exact: true }).check();
  await page.screenshot({ path: "../../qa/settings-20261025.png", fullPage: true });
  await page.goto("/");
  await expect(page.locator(".product-shell")).toHaveClass(/large-text/);
});
test("Studio submits one explicit image request and displays its PNG without an extra consent checkbox", async ({
  page
}) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const image = {
    id,
    kind: "image",
    status: "done",
    error_code: null,
    created_at: new Date().toISOString(),
    asset: { mime: "image/png", extension: "png", bytes: 68 }
  };
  let calls = 0;
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({
      json: {
        capabilities: { image_generation: { ready: true, model: "fixture-image", reason: null } }
      }
    })
  );
  await page.route("**/api/v1/media/jobs", (route) =>
    route.fulfill({ json: { items: calls ? [image] : [] } })
  );
  await page.route("**/api/v1/media/assets/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/5d8AAAAASUVORK5CYII=",
        "base64"
      )
    })
  );
  await page.route("**/api/v1/media/images", async (route) => {
    calls++;
    expect(route.request().postDataJSON()).toMatchObject({
      prompt: "Монохромный постер",
      explicit_paid_consent: true
    });
    await route.fulfill({ status: 202, json: image });
  });
  await page.goto("/?surface=images");
  await page
    .getByRole("textbox", { name: "Описание изображения", exact: true })
    .fill("Монохромный постер");
  await expect(page.getByRole("checkbox", { name: /Подтверждаю генерацию/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Сгенерировать изображение", exact: true }).click();
  await expect(
    page.getByRole("img", { name: "Сгенерированное изображение", exact: true })
  ).toBeVisible();
  expect(calls).toBe(1);
  await page.screenshot({ path: "../../qa/image-studio-20261025.png", fullPage: true });
});
