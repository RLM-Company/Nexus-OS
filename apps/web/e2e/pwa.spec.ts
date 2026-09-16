import { expect, test } from "@playwright/test";

test("publishes an installable standalone app manifest and icons", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = (await response.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
  };
  expect(manifest).toMatchObject({
    name: "Cosmora AI",
    short_name: "Cosmora",
    start_url: "/",
    scope: "/",
    display: "standalone"
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ src: "/icon", sizes: "512x512", type: "image/png" }),
      expect.objectContaining({ src: "/apple-icon", sizes: "180x180", type: "image/png" })
    ])
  );

  for (const path of ["/icon", "/apple-icon"]) {
    const icon = await request.get(path);
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toContain("image/png");
    expect((await icon.body()).byteLength).toBeGreaterThan(1_000);
  }
});

test("keeps the Cosmora chat usable at a smartphone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Мобильная навигация" })).toBeVisible();
  await expect(page.getByLabel("Сообщение Cosmora")).toBeVisible();
  await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  expect(
    await page.locator("#workspace").evaluate((workspace) => ({
      left: Math.round(workspace.getBoundingClientRect().left),
      width: Math.round(workspace.getBoundingClientRect().width)
    }))
  ).toEqual({ left: 0, width: 390 });
});

test("keeps an ordinary chat separate from projects", async ({ page }) => {
  let projectPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/projects")) {
      projectPosts += 1;
    }
  });
  await page.goto("/");

  const firstGreeting = await page.locator(".hero h2").innerText();
  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await expect(page.locator(".hero h2")).not.toHaveText(firstGreeting);
  await expect(page.locator(".hero p")).toHaveCount(0);
  await expect(page.locator(".foundation-grid")).toHaveCount(0);
  await expect(page.locator("#next-logo")).toHaveCount(0);
  const composer = page.getByLabel("Сообщение Cosmora");
  await composer.fill("Привет! Как ты?");
  await page.getByRole("button", { name: "Отправить" }).click();

  await expect(page.getByRole("region", { name: "Обычный чат Cosmora" })).toContainText(
    "проект не создан"
  );
  await expect(page.getByRole("complementary", { name: "Предложение создать проект" })).toHaveCount(
    0
  );
  expect(projectPosts).toBe(0);

  const chatsToggle = page.getByRole("button", { name: /Чаты/ });
  const projectsToggle = page.getByRole("button", { name: /Проекты/ });
  await expect(chatsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.locator("#sidebar-chat-list").getByRole("button", { name: /Привет! Как ты/ })
  ).toBeVisible();
  await chatsToggle.click();
  await expect(chatsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#sidebar-chat-list")).toHaveCount(0);
  await projectsToggle.click();
  await expect(projectsToggle).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(chatsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(projectsToggle).toHaveAttribute("aria-expanded", "false");
  await chatsToggle.click();
  await page
    .locator("#sidebar-chat-list")
    .getByRole("button", { name: /Привет! Как ты/ })
    .click();
  await expect(page.getByRole("region", { name: "Обычный чат Cosmora" })).toContainText(
    "Привет! Как ты?"
  );
});

test("suggests a project for a complex task and creates it only after confirmation", async ({
  page
}) => {
  let projectPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/projects")) {
      projectPosts += 1;
    }
  });
  await page.goto("/");
  const task =
    "Создай проект: сначала разработай приложение с API и базой данных, затем добавь интерфейс и e2e-тесты";
  await page.getByLabel("Сообщение Cosmora").fill(task);
  await page.getByRole("button", { name: "Отправить" }).click();

  const proposal = page.getByRole("complementary", { name: "Предложение создать проект" });
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText("мультиагентной команды");
  expect(projectPosts).toBe(0);

  const createdProject = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") && response.request().method() === "POST"
  );
  await proposal.getByRole("button", { name: "Оформить как проект" }).click();
  const created = await createdProject;
  expect(created.status(), await created.text()).toBe(201);
  expect(projectPosts).toBe(1);
  await expect(page.getByRole("region", { name: "Главный чат проекта" })).toContainText(
    "мультиагентный проект"
  );
});

test("opens the image workspace and keeps generation local until a model is connected", async ({
  page
}) => {
  await page.goto("/");

  await expect(page.locator(".sidebar-tools").getByRole("button")).toHaveText([
    "Skills",
    "Code",
    "Work",
    "Изображения",
    "Видео",
    "Sound",
    "Мультиагент"
  ]);
  await page.getByRole("button", { name: "Изображения", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Создание изображений" })).toBeVisible();
  expect(
    await page.evaluate(() => {
      const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
      const panel = document.querySelector(".capability-workspace")?.getBoundingClientRect();
      return Boolean(topbar && panel && topbar.top < panel.top);
    })
  ).toBe(true);

  const prompt = page.getByLabel("Промпт для изображения");
  await prompt.fill("Минималистичный космический город на рассвете");
  await page.getByRole("button", { name: "16:9" }).click();
  await page.getByRole("button", { name: "Подготовить промпт" }).click();

  await expect(page.getByRole("status")).toContainText("сохранён локально");
  await expect(page.getByText("Внешняя модель не подключена")).toBeVisible();
});

test("offers the browser install action when the platform exposes it", async ({ page }) => {
  await page.goto("/");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const target = window as Window & { __cosmoraInstallPromptCalls?: number };
        target.__cosmoraInstallPromptCalls ??= 0;
        const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
          prompt: async () => {
            target.__cosmoraInstallPromptCalls = (target.__cosmoraInstallPromptCalls ?? 0) + 1;
          },
          userChoice: Promise.resolve({ outcome: "dismissed", platform: "web" })
        });
        window.dispatchEvent(event);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        return Boolean(document.querySelector('[aria-label="Установить Cosmora"]'));
      })
    )
    .toBe(true);

  const install = page.getByRole("button", { name: "Установить Cosmora" });
  await expect(install).toBeVisible();
  await install.click();
  expect(
    await page.evaluate(
      () =>
        (window as Window & { __cosmoraInstallPromptCalls?: number }).__cosmoraInstallPromptCalls
    )
  ).toBe(1);
});
