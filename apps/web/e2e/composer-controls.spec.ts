import { expect, test, type Page } from "@playwright/test";

async function speechFixture(page: Page, delay = 50) {
  await page.addInitScript(
    ({ delay }) => {
      const browser = window as unknown as { voiceSpoken: string[]; voiceStarted: number };
      browser.voiceSpoken = [];
      browser.voiceStarted = 0;
      class Recognition {
        lang = "";
        continuous = false;
        interimResults = false;
        onresult: ((event: unknown) => void) | null = null;
        onerror = null;
        onend: (() => void) | null = null;
        start() {
          browser.voiceStarted++;
          setTimeout(() => {
            // Deliberately deliver twice, even after stop, to verify deduplication/closing guards.
            this.onresult?.({ results: [[{ transcript: "Помоги составить план на завтра" }]] });
            this.onresult?.({ results: [[{ transcript: "Помоги составить план на завтра" }]] });
            this.onend?.();
          }, delay);
        }
        stop() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: Recognition
      });
      Object.defineProperty(window, "SpeechSynthesisUtterance", {
        configurable: true,
        value: class {
          constructor(public text: string) {}
        }
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: {
          cancel() {},
          speak(utterance: { text: string; onend?: () => void }) {
            browser.voiceSpoken.push(utterance.text);
            setTimeout(() => utterance.onend?.(), 20);
          }
        }
      });
    },
    { delay }
  );
}

test("composer order, hidden Relay/search, top-right settings and mobile fit", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  const composer = page.locator(".composer");
  await expect(composer.getByRole("switch")).toHaveCount(0);
  await expect(composer.locator(".web-search-panel")).toHaveCount(0);
  await expect(page.locator(".topbar").getByLabel("Настройки чата", { exact: true })).toBeVisible();
  const model = await page.getByLabel("Выбор модели").boundingBox();
  const mic = await page.getByLabel("Голосовой ввод", { exact: true }).boundingBox();
  const send = await page
    .getByRole("button", { name: "Открыть голосового помощника", exact: true })
    .boundingBox();
  expect(model!.x + model!.width).toBeLessThan(mic!.x);
  expect(mic!.x + mic!.width).toBeLessThanOrEqual(send!.x + 4);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await expect(page.getByRole("switch", { name: /English Relay/ })).toBeVisible();
  await page.getByLabel("Настройки чата", { exact: true }).press("Escape");
  await expect(page.getByRole("switch", { name: /English Relay/ })).not.toBeVisible();
  await page.screenshot({ path: "../../qa/kosmora-composer-revised-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel("Настройки чата", { exact: true }).click();
  const panel = await page.getByText("Настройки чата", { exact: true }).boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  await page.getByLabel("Настройки чата", { exact: true }).press("Escape");
  await page.getByLabel("Голосовой ввод", { exact: true }).click();
  const voicePanel = await page.locator("[data-voice-panel]").boundingBox();
  expect(voicePanel!.x).toBeGreaterThanOrEqual(0);
  expect(voicePanel!.x + voicePanel!.width).toBeLessThanOrEqual(390);
  await page.getByLabel("Голосовой ввод", { exact: true }).press("Escape");
  await page.screenshot({ path: "../../qa/kosmora-composer-revised-mobile.png", fullPage: true });
});

test("empty composer opens assistant without recording or submitting", async ({ page }) => {
  await speechFixture(page);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/(chats|projects)(?:[/?]|$)/.test(request.url()))
      posts++;
  });
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  const voice = page.getByRole("button", { name: "Открыть голосового помощника", exact: true });
  await expect(voice).toBeEnabled();
  await voice.click();
  await expect(page.getByRole("dialog", { name: "Голосовой помощник" })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { voiceStarted: number }).voiceStarted)
  ).toBe(0);
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Вернуться в чат" }).click();
  await page.getByLabel("Сообщение Kosmora").fill("Текст меняет основную кнопку");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
});

test("speech turn sends once, names the real chat and speaks only its new answer", async ({
  page
}) => {
  await speechFixture(page);
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/chats/.test(request.url()))
      posts.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Голосовой помощник", exact: true }).click();
  await page.getByRole("button", { name: "Говорить", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { voiceSpoken: string[] }).voiceSpoken.length)
    )
    .toBe(1);
  expect(posts).toHaveLength(1);
  await expect(page.locator(".topbar h1")).toHaveText("Помоги составить план на завтра");
  await page.getByRole("button", { name: "Вернуться в чат" }).click();
  await expect(page).toHaveURL(/\?chat=/);
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Помоги составить план на завтра");
});

test("closing a recording suppresses late recognition and keeps an existing draft", async ({
  page
}) => {
  await speechFixture(page, 500);
  let posts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/(chats|projects)(?:[/?]|$)/.test(request.url()))
      posts++;
  });
  await page.goto("/");
  await expect(page.getByLabel("Сообщение Kosmora")).toBeEnabled();
  await page.getByLabel("Открыть голосового помощника", { exact: true }).click();
  await page.getByRole("button", { name: "Говорить", exact: true }).click();
  await page.getByRole("button", { name: "Вернуться в чат" }).click();
  await page.getByLabel("Сообщение Kosmora").fill("Мой сохранённый черновик");
  await page.getByLabel("Настройки чата", { exact: true }).click();
  await page.getByRole("button", { name: "Голосовой помощник", exact: true }).click();
  await expect(page.getByRole("button", { name: "Говорить", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Вернуться в чат" }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Мой сохранённый черновик");
  await page.waitForTimeout(600);
  expect(posts).toBe(0);
});
