import { expect, test } from "@playwright/test";
import type { WorkDag } from "@cosmora/contracts";

test("the selected project plan survives reload without progressing from chat or replay", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Проект для плана", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = "/api/v1/projects/" + project.id + "/work-dags";
  const planResponse = await request.post(base, {
    data: {
      client_request_id: crypto.randomUUID(),
      title: "Подготовить отчёт по проекту",
      nodes: [
        { id: "brief", title: "Собрать данные", goal: "Подготовь бриф", depends_on: [] },
        { id: "report", title: "Написать отчёт", goal: "Подготовь отчёт", depends_on: ["brief"] }
      ]
    }
  });
  expect(planResponse.status()).toBe(201);
  const plan = (await planResponse.json()) as WorkDag;
  await page.goto(`/?project=${project.id}&view=chat&plan=${plan.id}`);
  const card = page.getByRole("region", { name: "Задачи и план чата" });
  await expect(card).toContainText(plan.title);
  await card.getByRole("button", { name: "Свернуть план" }).click();
  await expect(card.getByText("Собрать данные")).toHaveCount(0);
  await card.getByRole("button", { name: "Развернуть план" }).click();
  await expect(card.locator('[data-status="pending"]')).toContainText("Собрать данные");
  await expect(card.locator('[data-status="blocked"]')).toContainText("Написать отчёт");

  // Even a stale browser event from the old chat timer has no authority.
  await page.evaluate((scope) => {
    for (const type of ["queued", "run.started", "tool.call", "run.completed", "run.completed"])
      window.dispatchEvent(new CustomEvent("kosmora:chat-task-event", { detail: { scope, type } }));
  }, project.id);
  const composer = page.getByLabel("Сообщение менеджеру", { exact: true });
  await composer.fill("Коротко ответь на вопрос об этом проекте");
  await composer.press("Enter");
  await expect(composer).toHaveValue("");
  await expect(page.getByText("Ответ получен", { exact: true })).toBeVisible();
  await expect(card.locator('[data-status="pending"]')).toContainText("Собрать данные");
  await expect(card.locator('[data-status="blocked"]')).toContainText("Написать отчёт");
  await expect(card.getByLabel("Время по событиям")).toContainText("инструменты: —");
  await page.reload();
  await expect(card.locator('[data-status="pending"]')).toContainText("Собрать данные");
  await expect(card.locator('[data-status="blocked"]')).toContainText("Написать отчёт");
  const persisted = (await (await request.get(base + "/" + plan.id)).json()) as WorkDag;
  expect(persisted.nodes.map((node) => node.attempts.length)).toEqual([0, 0]);
  expect(persisted.version).toBe(plan.version);

  // Reusing an ID under a different project must never display the selected plan.
  const other = await request.post("/api/v1/projects", {
    data: { initial_message: "Другой проект", client_message_id: crypto.randomUUID() }
  });
  const { project: foreign } = (await other.json()) as { project: { id: string } };
  await page.goto(`/?project=${foreign.id}&view=chat&plan=${plan.id}`);
  await expect(card).toHaveCount(0);
});

test("a pinned chat plan picks up an external start and archive without a page reload", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Проверка обновления плана", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = "/api/v1/projects/" + project.id;
  const profile = await request.put(base + "/autonomy-profile", {
    data: { base_level: "A2", overrides: [], expected_version: 1 }
  });
  expect(profile.status()).toBe(200);
  const saved = await request.post(base + "/work-dags", {
    data: {
      client_request_id: crypto.randomUUID(),
      title: "План из другой вкладки",
      nodes: [{ id: "brief", title: "Бриф", goal: "Создай result.md", depends_on: [] }]
    }
  });
  expect(saved.status()).toBe(201);
  const plan = (await saved.json()) as WorkDag;
  const path = base + "/work-dags/" + plan.id;

  await page.goto(`/?project=${project.id}&view=chat&plan=${plan.id}`);
  const card = page.getByRole("region", { name: "Задачи и план чата" });
  await expect(card.locator('[data-status="pending"]')).toContainText("Бриф");
  const started = await request.post(path + "/control", {
    data: { action: "run", node_id: "brief", version: plan.version }
  });
  expect(started.status()).toBe(200);

  // Returning to the tab should get the update immediately, even after a
  // previously idle snapshot. Do not use a reload to recreate the hook.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.locator('[data-status="completed"]')).toContainText("Бриф", {
    timeout: 25_000
  });
  const done = (await (await request.get(path)).json()) as WorkDag;
  const archived = await request.put(path + "/archive", {
    data: { expected_version: done.version, archived: true }
  });
  expect(archived.status()).toBe(200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("plan")).toBe(plan.id);
});

test("plan search and missing links cannot silently select a different plan", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Проверка закрепления", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = "/api/v1/projects/" + project.id + "/work-dags";
  const plans: WorkDag[] = [];
  for (const title of ["Первый отчёт", "Второй отчёт"]) {
    const saved = await request.post(base, {
      data: {
        client_request_id: crypto.randomUUID(),
        title,
        nodes: [{ id: "brief", title: "Бриф", goal: "Создай result.md", depends_on: [] }]
      }
    });
    expect(saved.status()).toBe(201);
    plans.push((await saved.json()) as WorkDag);
  }
  const [first, second] = [plans[0]!, plans[1]!];
  await page.goto(`/?project=${project.id}&view=plan&plan=${first.id}`);
  const editor = page.getByRole("region", { name: "План с зависимостями", exact: true });
  const card = page.getByRole("region", { name: "Задачи и план чата", exact: true });
  const select = editor.getByLabel("Сохранённые планы");
  await expect(select).toHaveValue(first.id);
  await expect(card).toContainText(first.title);

  await editor.getByLabel("Поиск планов").fill(second.title);
  await expect(select.getByRole("option", { name: second.title, exact: true })).toHaveCount(1);
  await expect(select).toHaveValue("");
  await expect(editor.getByRole("button", { name: "Выполнить план", exact: true })).toHaveCount(0);
  await expect(card).toContainText(first.title);
  await expect(page).toHaveURL(new RegExp("plan=" + first.id + "$"));

  await select.selectOption(second.id);
  await expect(card).toContainText(second.title);
  await expect(page).toHaveURL(new RegExp("plan=" + second.id + "$"));

  const missing = crypto.randomUUID();
  await page.goto(`/?project=${project.id}&view=plan&plan=${missing}`);
  await expect(editor.getByText("План из ссылки не найден в этом проекте")).toBeVisible();
  await expect(select).toHaveValue("");
  await expect(editor.getByRole("button", { name: "Выполнить план", exact: true })).toHaveCount(0);
  await expect(card).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp("plan=" + missing + "$"));
  await select.selectOption(first.id);
  await expect(card).toContainText(first.title);
  await expect(editor.getByText("План из ссылки не найден в этом проекте")).toHaveCount(0);
});

test("switching the pinned plan in the same project fences a late snapshot and recovers a disconnected read", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Два независимых плана", client_message_id: crypto.randomUUID() }
  });
  const { project } = (await created.json()) as { project: { id: string } };
  const base = `/api/v1/projects/${project.id}/work-dags`;
  async function create(title: string) {
    const response = await request.post(base, {
      data: {
        title,
        client_request_id: crypto.randomUUID(),
        nodes: [{ id: "brief", title: "Проверить данные", goal: "Сверь данные", depends_on: [] }]
      }
    });
    expect(response.status()).toBe(201);
    return response.json() as Promise<WorkDag>;
  }
  const first = await create("План A");
  const second = await create("План B");
  const card = page.getByRole("region", { name: "Задачи и план чата" });
  await page.goto(`/?project=${project.id}&view=chat&plan=${first.id}`);
  await expect(card).toContainText(first.title);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**" + base + "/" + first.id, async (route) => {
    const old = await route.fetch();
    await hold;
    await route.fulfill({ response: old }).catch(() => undefined);
  });
  const dispatched = page.waitForRequest((req) => req.url().endsWith("/" + first.id));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await dispatched;
  await page.evaluate((id) => {
    const url = new URL(window.location.href);
    url.searchParams.set("plan", id);
    window.history.pushState(window.history.state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, second.id);
  await expect(card).toContainText(second.title);
  await expect(card.getByRole("link", { name: "Открыть управление планом" })).toHaveAttribute(
    "href",
    `/?project=${project.id}&view=plan&plan=${second.id}`
  );
  release();
  let online = false;
  await page.route("**" + base + "/" + second.id, (route) =>
    online ? route.continue() : route.abort()
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(card.getByRole("alert")).toContainText("последняя подтверждённая версия");
  await expect(card).not.toContainText(first.title);
  online = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card).toContainText(second.title);
});
