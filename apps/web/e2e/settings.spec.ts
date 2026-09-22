import { expect, test } from "@playwright/test";

test("persists companion and communication settings", async ({ page }) => {
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Настройки" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "ИИ может писать первой" })).toBeVisible();

  await page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" }).check();
  await page.getByLabel("Частота").selectOption("rare");
  await page.getByLabel("Максимум в день").fill("2");
  await page.getByLabel("Тихие часы с").fill("23:00");
  await page.getByLabel("Тихие часы до").fill("07:30");
  await page.getByLabel("Тон").selectOption("direct");
  await page.getByLabel("Подробность").selectOption("short");
  await page.getByLabel("Инициативность").selectOption("proactive");

  await expect(page.getByText(/до 2 сообщений\/день/)).toBeVisible();
  await page.getByRole("button", { name: "Проверить preview" }).click();
  await expect(page.getByText("Напишу только когда есть понятный повод")).toBeVisible();

  await page.reload();

  await expect(page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" })).toBeChecked();
  await expect(page.getByLabel("Частота")).toHaveValue("rare");
  await expect(page.getByLabel("Максимум в день")).toHaveValue("2");
  await expect(page.getByLabel("Тихие часы с")).toHaveValue("23:00");
  await expect(page.getByLabel("Тихие часы до")).toHaveValue("07:30");
  await expect(page.getByLabel("Тон")).toHaveValue("direct");
  await expect(page.getByLabel("Подробность")).toHaveValue("short");
  await expect(page.getByLabel("Инициативность")).toHaveValue("proactive");

  const persisted = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}")
  );
  expect(persisted).toMatchObject({
    version: 2,
    companion: {
      enabled: true,
      frequency: "rare",
      max_proactive_per_day: 2,
      quiet_hours: { start: "23:00", end: "07:30" }
    },
    communication: {
      tone: "direct",
      verbosity: "short",
      initiative: "proactive",
      natural_guardrail_enabled: true,
      avoid_canned_framing: true,
      prefer_concrete_examples: true,
      preserve_user_register: true
    }
  });
  expect(JSON.stringify(persisted)).not.toContain("token");
  expect(JSON.stringify(persisted)).not.toContain("secret");
});

test("keeps proactive daily cap integral before persistence", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" }).check();

  const dailyCap = page.getByLabel("Максимум в день");

  await dailyCap.fill("1.5");
  await expect(dailyCap).toHaveValue("3");

  await dailyCap.fill("21");
  await expect(dailyCap).toHaveValue("20");

  await dailyCap.fill("-1");
  await expect(dailyCap).toHaveValue("0");

  const persisted = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}")
  );
  expect(persisted.companion.max_proactive_per_day).toBe(0);
});

test("keeps auth preview explicit and does not expose credential inputs", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Вход в Cosmora" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Google" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Telegram" })).toBeDisabled();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("keeps settings usable at 390x844", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth
  }));

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  await expect(page.getByRole("link", { name: "Вход и верификация" })).toBeVisible();
});

test("migrates legacy settings to the bounded v2 contract", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cosmora:settings:v1",
      JSON.stringify({
        companionEnabled: true,
        proactiveFrequency: "often",
        quietStart: "21:30",
        quietEnd: "07:00",
        maxProactivePerDay: 4,
        tone: "warm",
        verbosity: "detailed",
        initiative: "proactive",
        naturalCommunicationGuardrail: false,
        notificationsEnabled: false
      })
    );
  });

  await page.goto("/settings");

  await expect(page.getByText("Старые настройки безопасно обновлены.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" })).toBeChecked();
  await expect(page.getByLabel("Частота")).toHaveValue("often");
  await expect(page.getByLabel("Максимум в день")).toHaveValue("4");
  await expect(page.getByLabel("Тон")).toHaveValue("warm");
  await expect(page.getByLabel("Подробность")).toHaveValue("detailed");

  const storage = await page.evaluate(() => ({
    legacy: window.localStorage.getItem("cosmora:settings:v1"),
    current: JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}")
  }));
  expect(storage.legacy).toBeNull();
  expect(storage.current.version).toBe(2);
  expect(storage.current.companion.min_gap_minutes).toBe(120);
  expect(storage.current.communication.avoid_canned_framing).toBe(true);
});

test("falls back to valid legacy settings when v2 JSON is corrupted", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cosmora:settings:v2", "{broken-json");
    window.localStorage.setItem(
      "cosmora:settings:v1",
      JSON.stringify({
        companionEnabled: true,
        proactiveFrequency: "often",
        quietStart: "21:30",
        quietEnd: "07:00",
        maxProactivePerDay: 4,
        tone: "warm",
        verbosity: "detailed",
        initiative: "proactive",
        naturalCommunicationGuardrail: false,
        notificationsEnabled: false,
        api_key: "must-not-survive"
      })
    );
  });

  await page.goto("/settings");

  await expect(
    page.getByText("Текущие настройки повреждены. Восстановлена предыдущая версия.")
  ).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" })).toBeChecked();
  await expect(page.getByLabel("Частота")).toHaveValue("often");
  await expect(page.getByLabel("Максимум в день")).toHaveValue("4");
  await expect(page.getByLabel("Тон")).toHaveValue("warm");
  await expect(page.getByLabel("Подробность")).toHaveValue("detailed");
  await expect(page.getByLabel("Инициативность")).toHaveValue("proactive");

  const storage = await page.evaluate(() => ({
    legacy: window.localStorage.getItem("cosmora:settings:v1"),
    current: window.localStorage.getItem("cosmora:settings:v2") ?? ""
  }));
  expect(storage.legacy).toBeNull();
  expect(storage.current).not.toContain("must-not-survive");

  const recovered = JSON.parse(storage.current);
  expect(recovered).toMatchObject({
    version: 2,
    companion: {
      enabled: true,
      frequency: "often",
      max_proactive_per_day: 4,
      quiet_hours: { start: "21:30", end: "07:00" }
    },
    communication: {
      tone: "warm",
      verbosity: "detailed",
      initiative: "proactive",
      natural_guardrail_enabled: false
    }
  });
});

test("recovers corrupted settings without exposing or preserving unsafe fields", async ({
  page
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("cosmora:settings:v2", "{broken-json");
  });

  await page.goto("/settings");

  await expect(
    page.getByText("Не удалось прочитать локальные настройки. Используются безопасные значения.")
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Разрешить ИИ писать первой" })
  ).not.toBeChecked();
  await expect(page.getByLabel("Частота")).toHaveValue("balanced");
  await expect(page.getByLabel("Максимум в день")).toHaveValue("3");

  const recovered = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem("cosmora:settings:v2") ?? "{}")
  );
  expect(recovered).toMatchObject({
    version: 2,
    companion: { enabled: false, max_proactive_per_day: 3 },
    communication: { tone: "natural", verbosity: "balanced", initiative: "balanced" }
  });
});

test("normalizes invalid persisted values and removes unknown secret-like fields", async ({
  page
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "cosmora:settings:v2",
      JSON.stringify({
        version: 2,
        companion: {
          enabled: true,
          frequency: "always",
          max_proactive_per_day: 999,
          min_gap_minutes: -1,
          quiet_hours: { start: "99:00", end: "08:00", timezone: "UTC" },
          suppress_when_active: true,
          backoff_after_unanswered: 999,
          allow_push: false,
          allow_telegram: false,
          api_key: "must-not-survive"
        },
        communication: {
          tone: "robot",
          verbosity: "endless",
          initiative: "unbounded",
          natural_guardrail_enabled: true,
          avoid_canned_framing: true,
          prefer_concrete_examples: true,
          preserve_user_register: true,
          access_token: "must-not-survive"
        },
        notifications_enabled: false,
        client_secret: "must-not-survive"
      })
    );
  });

  await page.goto("/settings");

  await expect(page.getByLabel("Частота")).toHaveValue("balanced");
  await expect(page.getByLabel("Максимум в день")).toHaveValue("3");
  await expect(page.getByLabel("Тихие часы с")).toHaveValue("22:00");
  await expect(page.getByLabel("Тон")).toHaveValue("natural");
  await expect(page.getByLabel("Подробность")).toHaveValue("balanced");
  await expect(page.getByLabel("Инициативность")).toHaveValue("balanced");

  const normalized = await page.evaluate(
    () => window.localStorage.getItem("cosmora:settings:v2") ?? ""
  );
  expect(normalized).not.toContain("must-not-survive");
  expect(normalized).not.toContain("api_key");
  expect(normalized).not.toContain("access_token");
  expect(normalized).not.toContain("client_secret");
});
