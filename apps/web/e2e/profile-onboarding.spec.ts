import { expect, test, type Page } from "@playwright/test";

type Settings = {
  version: number;
  relay_enabled: boolean;
  response_language: "ru" | "en";
  optimize_for: "balanced" | "cost" | "quality" | "latency";
  preferred_provider: string | null;
  preferred_model: string | null;
  chat_style: "standard" | "concise" | "detailed";
  max_total_tokens: number | null;
  display_name: string;
  user_gender: "masculine" | "feminine" | "neutral";
  assistant_gender: "masculine" | "feminine" | "neutral";
};

const fresh = (): Settings => ({
  version: 0,
  relay_enabled: false,
  response_language: "ru",
  optimize_for: "balanced",
  preferred_provider: null,
  preferred_model: null,
  chat_style: "standard",
  max_total_tokens: null,
  display_name: "",
  user_gender: "masculine",
  assistant_gender: "neutral"
});

/** Изолируем настройки в браузере, чтобы тест не зависел от общей БД фикстурного сервера. */
async function settingsFixture(page: Page) {
  let current = fresh();
  const writes: Array<Record<string, unknown>> = [];
  await page.route("**/api/v1/personal-settings", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      current = {
        ...current,
        display_name: typeof body.display_name === "string" ? body.display_name : "",
        user_gender: (body.user_gender as Settings["user_gender"]) ?? current.user_gender,
        assistant_gender:
          (body.assistant_gender as Settings["assistant_gender"]) ?? current.assistant_gender,
        version: current.version + 1
      };
      await route.fulfill({ status: 200, json: { settings: current } });
      return;
    }
    await route.fulfill({ status: 200, json: { settings: current } });
  });
  return {
    writes,
    read: () => current,
    saved: async () => {
      await page.waitForFunction(
        () => localStorage.getItem("kosmora:profile-onboarding.v1") === "done"
      );
    }
  };
}

test("first run: onboarding saves the profile and greets the first dialog", async ({ page }) => {
  const fixture = await settingsFixture(page);
  await page.goto("/");
  const dialog = page.getByRole("region", { name: "Давайте познакомимся" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Ваше имя").fill("Анна");
  await dialog.getByLabel("Род обращения к вам").selectOption("feminine");
  await dialog.getByLabel("Род ассистента").selectOption("feminine");
  await dialog.getByRole("button", { name: "Сохранить и начать" }).click();
  await expect(dialog).not.toBeVisible();
  await fixture.saved();

  expect(fixture.writes).toHaveLength(1);
  expect(fixture.writes[0]).toMatchObject({
    display_name: "Анна",
    user_gender: "feminine",
    assistant_gender: "feminine",
    expected_version: 0
  });

  // Имя сразу появляется в приветствии на первом экране.
  await expect(page.getByText("Анна, рад вас видеть.")).toBeVisible();

  // После перезагрузки онбординг не повторяется, имя берётся с сервера.
  await page.reload();
  await expect(page.getByRole("region", { name: "Давайте познакомимся" })).toHaveCount(0);
  await expect(page.getByText("Анна, рад вас видеть.")).toBeVisible();
  expect(fixture.read()).toMatchObject({
    display_name: "Анна",
    user_gender: "feminine",
    assistant_gender: "feminine"
  });

  // Первый диалог после онбординга отправляется в обычный чат.
  const editor = page.getByLabel("Сообщение Kosmora");
  await expect(editor).toBeEnabled();
  await editor.fill("Кто ты?");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Кто ты?");
});

test("first run can be skipped without changing server defaults", async ({ page }) => {
  const fixture = await settingsFixture(page);
  await page.goto("/");
  const dialog = page.getByRole("region", { name: "Давайте познакомимся" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Пропустить" }).click();
  await expect(dialog).not.toBeVisible();
  await fixture.saved();

  // Пропуск не пишет на сервер: сохраняются defaults.
  expect(fixture.writes).toHaveLength(0);
  expect(fixture.read()).toMatchObject({
    display_name: "",
    user_gender: "masculine",
    assistant_gender: "neutral"
  });

  await page.reload();
  await expect(page.getByRole("region", { name: "Давайте познакомимся" })).toHaveCount(0);
});
