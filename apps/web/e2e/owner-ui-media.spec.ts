import { expect, test } from "@playwright/test";

// First-run profile onboarding is a separate owner flow with its own spec.
// Its modal intercepts clicks on these UI/media checks, so mark it done before
// every test here. No product code or onboarding behaviour is changed.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
    } catch {
      /* Storage may be unavailable; the tests then still exercise the surface. */
    }
  });
});

test("centered mode control and project creation without a model call", async ({ page }) => {
  await page.goto("/");
  const switcher = page.getByRole("group", { name: "Режим нового чата" });
  await expect(switcher).toBeVisible();
  const header = await page.locator(".topbar").boundingBox();
  const control = await switcher.boundingBox();
  expect(Math.abs(control!.x + control!.width / 2 - header!.x - header!.width / 2)).toBeLessThan(3);
  expect(control!.height).toBeGreaterThanOrEqual(44);
  await switcher.getByRole("button", { name: "Работа", exact: true }).click();
  await expect(switcher.getByRole("button", { name: "Работа", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  await page.screenshot({ path: "../../qa/owner-ui-centered.png" });
  const projects = page.locator("#sidebar-project-list");
  await expect(projects.locator(":scope > button").first()).toHaveText("Создать проект+");
  await projects.getByRole("button", { name: "Создать проект", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Создать проект", exact: true });
  await dialog.getByLabel("Название проекта", { exact: true }).fill("Пустой проект проверки");
  let paidPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/(messages|runs)$/.test(new URL(request.url()).pathname))
      paidPosts++;
  });
  await dialog.getByRole("button", { name: "Создать проект", exact: true }).click();
  await expect(page.locator(".topbar h1")).toHaveText("Пустой проект проверки");
  await expect(projects).toContainText("Пустой проект проверки");
  expect(paidPosts).toBe(0);
  await page.reload();
  await expect(page.locator(".topbar h1")).toHaveText("Пустой проект проверки");
});

test("chat menu escapes narrow and scrolling sidebar; exports and archives a real local chat", async ({
  page,
  request
}) => {
  const title = `Меню ${crypto.randomUUID().slice(0, 6)}`;
  const result = await request.post("http://127.0.0.1:3100/api/v1/chats", {
    data: { initial_message: title, client_message_id: crypto.randomUUID(), mode: "kosmora" }
  });
  expect(result.status()).toBe(201);
  const { chat } = await result.json();
  await page.goto(`/?chat=${chat.id}`);
  await expect(page.getByLabel("Сообщение Kosmora", { exact: true })).toBeEnabled();
  const resize = page.getByRole("separator", { name: "Ширина боковой панели" });
  await resize.focus();
  await resize.press("Home");
  await page.getByLabel(`Действия с чатом «${title}»`, { exact: true }).click();
  const menu = page.getByRole("dialog", { name: `Меню чата «${title}»`, exact: true });
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(12);
  expect(box!.y).toBeGreaterThanOrEqual(12);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
  expect(box!.y + box!.height).toBeLessThanOrEqual(720);
  for (const label of [
    "Открыть чат",
    "Закрепить",
    "Переименовать",
    "Копировать ссылку",
    "Скачать Markdown",
    "Скачать JSON",
    "В архив",
    "Удалить чат"
  ])
    await expect(menu.getByRole("button", { name: label, exact: true }).locator("svg")).toHaveCount(
      1
    );
  await page.screenshot({ path: "../../qa/owner-ui-chat-menu.png" });
  const download = page.waitForEvent("download");
  await menu.getByRole("button", { name: "Скачать Markdown", exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.md$/);
  await menu.getByRole("button", { name: "В архив", exact: true }).click();
  await expect(menu).toHaveCount(0);
  await expect(page.locator(".sidebar .chat-item").filter({ hasText: title })).toHaveCount(0);
  const archived = await request.get("http://127.0.0.1:3100/api/v1/chats?archived=true");
  expect((await archived.json()).items.some((item: { id: string }) => item.id === chat.id)).toBe(
    true
  );
});

test("media uses generator workspaces, local references and no fake prompt results", async ({
  page
}) => {
  let mediaPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/media/")) mediaPosts++;
  });
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({
      json: {
        capabilities: {
          image_generation: {
            ready: true,
            model: "gpt-image-1",
            reason: null,
            constraints: {
              sizes: ["1024x1024", "1536x1024", "1024x1536"],
              aspectRatios: ["1:1", "3:2", "2:3"],
              qualities: ["low", "medium", "high", "auto"],
              formats: ["png", "jpeg", "webp"],
              maxCount: 1,
              maxPromptLength: 2000,
              supportsReferenceImage: false
            }
          },
          speech: { ready: false },
          transcription: { ready: false }
        }
      }
    })
  );
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/?surface=images");
  await expect(page.getByLabel("Описание изображения", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Подготовить промпт" })).toHaveCount(0);
  await page.getByLabel("Описание изображения", { exact: true }).fill("Лунная станция");
  const generate = page.getByRole("button", { name: "Сгенерировать изображение", exact: true });
  await expect(
    page.getByRole("checkbox", { name: "Подтверждаю генерацию с расходом баланса." })
  ).toHaveCount(0);
  await expect(generate).toBeEnabled();
  await expect(page.getByRole("button", { name: /Добавить референсы/ })).toBeDisabled();
  await expect(
    page.getByText("Редактирование по референсам пока не объявлено сервером и отключено.")
  ).toBeVisible();
  await page.getByRole("button", { name: "3:2 · 1536 × 1024" }).click();
  await page.getByLabel("Качество изображения").selectOption("high");
  await page.getByLabel("Формат результата").selectOption("webp");
  await expect(generate).toBeEnabled();
  await page.screenshot({ path: "../../qa/owner-ui-images.png" });
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width
    );
  }
  await page.goto("/?surface=video");
  await expect(page.getByLabel("Длительность", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Сгенерировать видео", exact: true })
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Подготовить промпт" })).toHaveCount(0);
  expect(mediaPosts).toBe(0);
});

// Stage-three Studio: "сохранить настройки генерации". The Sound draft test in
// media-job-recovery.spec.ts covers an unsent TEXT draft; the image generator's
// prompt and negotiated options are a different local draft and are asserted
// here without creating any paid media job.
test("image generation settings survive navigation and reload without a paid job", async ({
  page
}) => {
  let mediaPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/media/")) mediaPosts++;
  });
  const capabilities = {
    capabilities: {
      image_generation: {
        ready: true,
        model: "gpt-image-1",
        reason: null,
        constraints: {
          sizes: ["1024x1024", "1536x1024", "1024x1536"],
          aspectRatios: ["1:1", "3:2", "2:3"],
          qualities: ["low", "medium", "high", "auto"],
          formats: ["png", "jpeg", "webp"],
          maxCount: 1,
          maxPromptLength: 2000,
          supportsReferenceImage: false
        }
      },
      speech: { ready: false },
      transcription: { ready: false }
    }
  };
  await page.route("**/api/v1/media/capabilities", (route) =>
    route.fulfill({ json: capabilities })
  );
  await page.route("**/api/v1/media/jobs", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/?surface=images");
  await page.getByLabel("Описание изображения", { exact: true }).fill("Лунная станция");
  await page.getByRole("button", { name: "3:2 · 1536 × 1024" }).click();
  await page.getByLabel("Качество изображения").selectOption("high");
  await page.getByLabel("Формат результата").selectOption("webp");
  await expect(page.getByRole("button", { name: "3:2 · 1536 × 1024" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );

  const expectSaved = async () => {
    await expect(page.getByLabel("Описание изображения", { exact: true })).toHaveValue(
      "Лунная станция"
    );
    await expect(page.getByLabel("Качество изображения")).toHaveValue("high");
    await expect(page.getByLabel("Формат результата")).toHaveValue("webp");
    await expect(page.getByRole("button", { name: "3:2 · 1536 × 1024" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  };
  // Leaving the surface and coming back keeps the same local draft.
  await page.goto("/?surface=video");
  await page.goto("/?surface=images");
  await expectSaved();
  // A full reload restores it too; no generation was ever dispatched.
  await page.reload();
  await expectSaved();
  expect(mediaPosts).toBe(0);
});
