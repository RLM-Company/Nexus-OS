import { test, expect } from "@playwright/test";

test("new-chat mode preserves draft, stores Work and stays between title and actions", async ({
  page
}) => {
  await page.goto("/");
  const input = page.getByLabel("Сообщение Kosmora", { exact: true });
  await expect(input).toBeEnabled();
  const modes = page.getByRole("group", { name: "Режим нового чата" });
  await input.fill("Режим работы " + crypto.randomUUID().slice(0, 6));
  const draft = await input.inputValue();
  await modes.getByRole("button", { name: "Работа", exact: true }).click();
  await expect(modes.getByRole("button", { name: "Работа", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await expect(input).toHaveValue(draft);
  await expect(page).toHaveURL(/mode=work/);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const title = await page.locator(".topbar h1").boundingBox();
    const toggle = await modes.boundingBox();
    const actions = await page.locator(".topbar-actions").boundingBox();
    expect(title!.x + title!.width).toBeLessThanOrEqual(toggle!.x + 1);
    expect(toggle!.x + toggle!.width).toBeLessThanOrEqual(actions!.x + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
    await page.screenshot({ path: `../../qa/koswork-header-${width}.png` });
  }
  const creation = page.waitForRequest(
    (r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chats"
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  expect((await creation).postDataJSON().mode).toBe("work");
  await expect(modes).toHaveCount(0);
});

test("sidebar drag, keyboard, persistence and outlined unframed brand", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const handle = page.getByRole("separator", { name: "Ширина боковой панели" });
  await expect(handle).toHaveAttribute("aria-valuenow", "244");
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 160);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 70, box!.y + 160, { steps: 8 });
  await page.mouse.up();
  await expect(handle).toHaveAttribute("aria-valuenow", "314");
  expect((await page.locator(".sidebar").boundingBox())!.width).toBe(314);
  expect((await page.locator(".workspace").boundingBox())!.x).toBe(314);
  await handle.focus();
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "322");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "322");
  await expect(page.locator(".brand-mark img")).toHaveCount(0);
  await expect(page.locator(".brand-mark svg").first()).toHaveAttribute("fill", "none");
  expect(
    await page
      .locator(".brand-mark")
      .first()
      .evaluate((el) => getComputedStyle(el).borderTopWidth)
  ).toBe("0px");
  await page.screenshot({ path: "../../qa/koswork-sidebar-outline.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(".sidebar")).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(handle).toHaveAttribute("aria-valuenow", "322");
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "190");
  await handle.press("End");
  await expect(handle).toHaveAttribute("aria-valuenow", "420");
});

test("effort drag commits once on release and failed save restores previous value", async ({
  page
}) => {
  let effort: string | null = null;
  let saves = 0;
  let fail = false;
  await page.route("**/api/v1/personal-settings", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: {
        ...(await response.json()),
        reasoning: { effort, supported_efforts: ["low", "medium", "high"] }
      }
    });
  });
  await page.route("**/api/v1/personal-settings/reasoning", async (route) => {
    saves++;
    if (fail) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    effort = route.request().postDataJSON().effort;
    await route.fulfill({ json: { effort, supported_efforts: ["low", "medium", "high"] } });
  });
  await page.goto("/");
  await expect(page.getByLabel("Выбор модели", { exact: true })).toHaveAttribute(
    "aria-disabled",
    "false"
  );
  await page.getByLabel("Выбор модели", { exact: true }).click();
  const slider = page.getByRole("slider", { name: "Уровень усилий" });
  await expect(slider).toBeEnabled();
  const box = await slider.boundingBox();
  await page.mouse.move(box!.x + 8, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 8, box!.y + box!.height / 2, { steps: 12 });
  await expect(slider).toHaveAttribute("aria-valuetext", "Высокие");
  expect(saves).toBe(0);
  await page.mouse.up();
  await expect(slider).toBeEnabled();
  expect(effort).toBe("high");
  expect(saves).toBe(1);
  await page.screenshot({ path: "../../qa/koswork-effort-slider.png" });
  fail = true;
  await slider.focus();
  await slider.press("Home");
  await expect(page.getByText("Усилия не изменены. Повторите выбор.")).toBeVisible();
  await expect(slider).toHaveAttribute("aria-valuetext", "Высокие");
  expect(effort).toBe("high");
  expect(saves).toBe(2);
});

test("usage analytics shows real counters, filters rows, opens details and fits mobile", async ({
  page
}) => {
  const row = {
    kind: "model",
    chat_id: "chat-42",
    run_id: "run-42",
    provider_id: "mock",
    model_id: "mock-model",
    status: "committed",
    input_tokens: 120,
    output_tokens: 80,
    reserved_tokens: 0,
    created_at: "2026-10-18T10:00:00Z"
  };
  await page.route("**/api/v1/personal-settings/usage", (route) =>
    route.fulfill({
      json: {
        summary: {
          model_tokens_or_upper_bound: 200,
          translation_tokens_or_upper_bound: 0,
          in_flight_or_uncertain_holds: 50,
          total_counted_tokens: 250,
          max_total_tokens: 1000
        },
        rows: [
          row,
          {
            ...row,
            run_id: "run-43",
            model_id: "other-model",
            status: "reserved",
            input_tokens: null,
            output_tokens: null,
            reserved_tokens: 50
          }
        ]
      }
    })
  );
  await page.goto("/personal-settings");
  await expect(page.getByLabel("Показатели использования")).toContainText("250");
  await expect(
    page.getByRole("progressbar", { name: "Использование персонального лимита" })
  ).toHaveAttribute("value", "250");
  await page.getByLabel("Состояние запроса", { exact: true }).selectOption("committed");
  await expect(page.getByRole("status").filter({ hasText: "Показано" })).toHaveText(
    "Показано 1 из 2 последних попыток"
  );
  const detail = page.getByRole("button", { name: "Подробнее о запросе run-42", exact: true });
  await detail.click();
  const dialog = page.getByRole("dialog", { name: "Подробности запроса" });
  await expect(dialog).toContainText("chat-42");
  await expect(dialog).toContainText("120");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(detail).toBeFocused();
  await page.getByLabel("Поиск по модели или запросу").fill("missing");
  await expect(page.getByText("По выбранным фильтрам запросов нет.")).toBeVisible();
  await page.getByRole("button", { name: "Сбросить всё" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Показано" })).toHaveText(
    "Показано 2 из 2 последних попыток"
  );
  await page.screenshot({ path: "../../qa/koswork-account-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: "../../qa/koswork-account-mobile.png", fullPage: true });
});
