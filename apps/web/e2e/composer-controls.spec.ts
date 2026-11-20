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
            this.onresult?.({
              resultIndex: 0,
              results: [[{ transcript: "Помоги составить план на завтра" }]]
            });
            this.onresult?.({
              resultIndex: 0,
              results: [[{ transcript: "Помоги составить план на завтра" }]]
            });
            this.onend?.();
          }, delay);
        }
        stop() {
          this.onend?.();
        }
        abort() {
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

test("dictation requests microphone access and inserts a deduplicated draft", async ({ page }) => {
  await speechFixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (options: MediaStreamConstraints) => {
          if (!options.audio) throw new Error("Microphone permission not requested");
          return new MediaStream();
        }
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("Голосовой ввод", { exact: true }).click();
  await page.getByRole("button", { name: "Диктовать в браузере" }).click();
  await expect(page.getByLabel("Сообщение Kosmora")).toHaveValue("Помоги составить план на завтра");
});

test("project dictation recovers from microphone errors and stays in its project draft", async ({
  page,
  request
}) => {
  const response = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Проект для диктовки",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(response.status()).toBe(201);
  const { project } = (await response.json()) as { project: { id: string; title: string } };
  await speechFixture(page);
  await page.addInitScript(() => {
    let attempts = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async ({ audio }: MediaStreamConstraints) => {
          if (!audio) throw new Error("Microphone permission not requested");
          attempts++;
          if (attempts === 1) throw new DOMException("Permission denied", "NotAllowedError");
          if (attempts === 2) throw new DOMException("No microphone", "NotFoundError");
          return new MediaStream();
        }
      }
    });
  });

  await page.goto("/");
  const sidebar = page.locator(".sidebar");
  const openProjectChat = async () => {
    await sidebar
      .getByRole("button")
      .filter({ has: page.locator(`[id="pin-project-${project.id}"]`) })
      .click();
    await sidebar
      .getByLabel(`Чаты проекта ${project.title}`)
      .getByRole("button", { name: /Новый чат в проекте/ })
      .click();
  };
  await openProjectChat();
  const editor = page.getByLabel("Сообщение Kosmora");
  const draft = "Черновик проекта.";
  await editor.fill(draft);
  await page.getByLabel("Голосовой ввод", { exact: true }).click();
  await page.getByRole("button", { name: "Диктовать в браузере" }).click();
  await expect(page.getByRole("status")).toContainText("Разрешите доступ к микрофону");
  await expect(editor).toHaveValue(draft);
  const retry = page.getByRole("button", { name: "Повторить диктовку" });
  await retry.click();
  await expect(page.getByRole("status")).toContainText("Микрофон недоступен");
  await expect(editor).toHaveValue(draft);
  expect(await page.evaluate(() => Reflect.get(window, "voiceStarted"))).toBe(0);
  await retry.click();
  const dictated = `${draft} Помоги составить план на завтра`;
  await expect(editor).toHaveValue(dictated);
  await expect(page.getByRole("status")).toContainText("Текст добавлен в черновик");

  await page.reload();
  await expect(editor).toHaveValue("");
  await openProjectChat();
  await expect(editor).toHaveValue(dictated);
});

test("dictation stops explicitly and retries after a recognition error", async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { dictationAttempts: number };
    state.dictationAttempts = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (options: MediaStreamConstraints) => {
          if (!options.audio) throw new Error("Microphone permission not requested");
          return new MediaStream();
        }
      }
    });
    class Recognition {
      lang = "ru-RU";
      continuous = true;
      interimResults = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        state.dictationAttempts++;
        if (state.dictationAttempts === 1) {
          // Первый запуск: браузер не распознал речь.
          setTimeout(() => this.onerror?.({ error: "no-speech" }), 30);
          return;
        }
        setTimeout(() => {
          this.onresult?.({
            resultIndex: 0,
            results: [[{ transcript: "Помоги составить план на завтра" }]]
          });
          this.onend?.();
        }, 30);
      }
      stop() {
        this.onend?.();
      }
      abort() {
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
      value: { cancel() {}, speak() {} }
    });
  });
  await page.goto("/");
  const editor = page.getByLabel("Сообщение Kosmora");
  await expect(editor).toBeEnabled();
  await page.getByLabel("Голосовой ввод", { exact: true }).click();
  await page.getByRole("button", { name: "Диктовать в браузере" }).click();
  await expect(page.getByRole("status")).toContainText("Речь не распознана");
  const retry = page.getByRole("button", { name: "Повторить диктовку" });
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(editor).toHaveValue("Помоги составить план на завтра");
  await expect(page.getByRole("status")).toContainText("Текст добавлен в черновик");
});

test("dictation can be stopped explicitly without losing the draft", async ({ page }) => {
  await speechFixture(page, 800);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (options: MediaStreamConstraints) =>
          options.audio ? new MediaStream() : Promise.reject(new Error("No audio requested"))
      }
    });
  });
  await page.goto("/");
  const editor = page.getByLabel("Сообщение Kosmora");
  await expect(editor).toBeEnabled();
  await page.getByLabel("Голосовой ввод", { exact: true }).click();
  await page.getByRole("button", { name: "Диктовать в браузере" }).click();
  const stop = page.getByRole("button", { name: "Остановить диктовку" });
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(page.getByRole("status")).toContainText("Диктовка остановлена");
  await expect(page.getByRole("button", { name: "Диктовать в браузере" })).toBeEnabled();
  await expect(editor).toHaveValue("");
});

test("composer opens Deep Research inside the workspace", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Добавить в чат" }).click();
  const actions = page.locator(".attachment-actions");
  await expect(actions.getByRole("button", { name: "Прикрепить фото" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "Прикрепить файл" })).toBeVisible();
  await actions.getByRole("button", { name: "Deep Research" }).click();
  await expect(page).toHaveURL(/\?surface=research/);
  await expect(page.getByRole("heading", { name: "Глубокий поиск" })).toBeVisible();
});
