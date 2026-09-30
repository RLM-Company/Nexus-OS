import { expect, test } from "@playwright/test";

test("retains the draft and sends no chat request by button or Enter during a global stop", async ({
  page
}) => {
  const posts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/v1\/(chats|projects)/u.test(request.url()))
      posts.push(request.url());
  });
  let stopped = true;
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({
      json: {
        process_stop: stopped ? { active: true, reason: "private-stop-reason" } : null
      }
    })
  );
  await page.goto("/");
  await expect(page.getByTestId("chat-execution-gate")).toContainText("для всех проектов");
  const draft = page.getByLabel("Сообщение Cosmora");
  await draft.fill("Сохранённый запрос для будущего запуска");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  await draft.press("Enter");
  await expect(draft).toHaveValue("Сохранённый запрос для будущего запуска");
  expect(posts).toEqual([]);
  await expect(page.locator("body")).not.toContainText("private-stop-reason");
  stopped = false;
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
  await expect(draft).toHaveValue("Сохранённый запрос для будущего запуска");
  expect(posts).toEqual([]);
});

test("checks the selected project stop and keeps an ordinary chat independent", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Проект для проверки остановки чата",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: null, active_project_stops: 1 } })
  );
  await page.route("**/api/v1/operations/emergency-stop?**", (route) => {
    expect(new URL(route.request().url()).searchParams.get("project_id")).toBe(project.id);
    return route.fulfill({ json: { active: true } });
  });
  await page.goto(`/?project=${project.id}&view=chat`);
  await expect(page.getByTestId("chat-execution-gate")).toContainText("для этого проекта");
  await page.getByLabel("Сообщение менеджеру").fill("Не отправлять при остановке проекта");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Новый чат", exact: true }).click();
  await page
    .getByLabel("Сообщение Cosmora")
    .fill("Обычный чат не относится к остановленному проекту");
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
});

test("bounds unavailable evidence without consuming the draft or showing private details", async ({
  page
}) => {
  let available = false;
  await page.route("**/api/v1/operations/status", async (route) => {
    if (available) await route.fulfill({ json: { process_stop: null } });
  });
  await page.goto("/");
  await page.getByLabel("Сообщение Cosmora").fill("Черновик остаётся в редакторе");
  await expect(page.getByTestId("chat-execution-gate")).toContainText("Не удалось проверить", {
    timeout: 9_000
  });
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeDisabled();
  available = true;
  await expect(page.getByRole("button", { name: "Отправить", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Сообщение Cosmora")).toHaveValue("Черновик остаётся в редакторе");
});

test("does not promote a saved proposal to a model-starting project while stopped", async ({
  page
}) => {
  let stopped = false;
  let projectsPosted = 0;
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: stopped ? { active: true } : null } })
  );
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/v1/projects")) projectsPosted++;
  });
  await page.goto("/");
  await page
    .getByLabel("Сообщение Cosmora")
    .fill("Оформи как проект: подготовь план запуска продукта");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Оформить как проект", exact: true })
  ).toBeVisible();
  stopped = true;
  await expect(page.getByTestId("chat-execution-gate")).toContainText("для всех проектов");
  await expect(
    page.getByRole("button", { name: "Оформить как проект", exact: true })
  ).toBeDisabled();
  expect(projectsPosted).toBe(0);
});
