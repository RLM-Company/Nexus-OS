import { expect, test, type APIRequestContext } from "@playwright/test";

test.afterEach(async ({ page }) => {
  // Drain read interceptors before closing the page and starting the next test.
  await page.unrouteAll({ behavior: "wait" });
});

async function preparedWork(request: APIRequestContext, autonomy: "A1" | "A2" = "A2") {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Progress refresh acceptance",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const base = `/api/v1/projects/${project.id}`;
  expect(
    (
      await request.put(`${base}/autonomy-profile`, {
        data: {
          base_level: autonomy,
          overrides: [],
          expected_version: 1
        }
      })
    ).status()
  ).toBe(200);
  const response = await request.post(`${base}/work`, {
    data: {
      client_request_id: crypto.randomUUID(),
      goal: "Create result.md with a short complete report",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    }
  });
  expect(response.status()).toBe(201);
  const work = (await response.json()) as { id: string };
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${base}/work/${work.id}`)).json()) as { status: string })
          .status,
      { timeout: 15000 }
    )
    .toBe(autonomy === "A2" ? "completed" : "awaiting_approval");
  return {
    project: project.id,
    work: `${base}/work/${work.id}`,
    runtime: `${base}/work/${work.id}/runtime`
  };
}

test("project memory clears recovered read warnings without hiding rejected writes", async ({
  page,
  request
}) => {
  const work = await preparedWork(request);
  const path = `/api/v1/projects/${work.project}/memory`;
  let fail = false;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      if (route.request().method() === "POST")
        return route.fulfill({ status: 409, json: { error: "MEMORY_BUSY" } });
      if (route.request().method() === "GET" && fail)
        return route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
      return route.continue();
    }
  );
  await page.goto(`/?project=${work.project}&view=plan`);
  const memory = page.getByRole("region", { name: "Память проекта", exact: true });
  await expect(memory.getByText("Записей по запросу нет.", { exact: true })).toBeVisible();
  const refresh = memory.getByRole("button", { name: "Обновить память", exact: true });
  const warning = memory.getByText("Не удалось загрузить память проекта", { exact: true });
  fail = true;
  await refresh.click();
  await expect(warning).toBeVisible();
  fail = false;
  await refresh.click();
  await expect(warning).toBeHidden();
  await memory.getByLabel("Название записи", { exact: true }).fill("Owner requirement");
  await memory
    .getByLabel("Содержание записи", { exact: true })
    .fill("Keep all stated constraints.");
  await memory.getByRole("button", { name: "Добавить в память", exact: true }).click();
  const rejected = memory.getByText(
    "Запись изменилась или достигнут лимит. Обновите список и повторите действие.",
    { exact: true }
  );
  await expect(rejected).toBeVisible();
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "GET"
  );
  await refresh.click();
  expect((await refreshed).status()).toBe(200);
  await expect(rejected).toBeVisible();
  fail = true;
  const failed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "GET"
  );
  await refresh.click();
  expect((await failed).status()).toBe(503);
  await expect(rejected).toBeVisible();
  fail = false;
  const recovered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === path && response.request().method() === "GET"
  );
  await refresh.click();
  expect((await recovered).status()).toBe(200);
  await expect(rejected).toBeVisible();
});

test("unchanged completed progress does not refetch on a timer", async ({ page, request }) => {
  const work = await preparedWork(request);
  let reads = 0;
  await page.route(`**${work.runtime}`, (route) => {
    reads++;
    return route.continue();
  });
  await page.clock.install();
  await page.goto(`/?project=${work.project}&view=plan`);
  const progress = page.getByRole("region", { name: "Прогресс Work", exact: true });
  await expect(progress.getByText("Завершено этапов: 4 / 4", { exact: true })).toBeVisible();
  const initial = reads;
  expect(initial).toBeGreaterThan(0);
  await page.clock.fastForward(7000);
  await expect(
    page.getByRole("region", { name: "Выполнение задачи Manager", exact: true })
  ).toBeVisible();
  expect(reads).toBe(initial);
});

test("selected work stays open outside the history window and keeps control commands scoped", async ({
  page,
  request
}) => {
  const work = await preparedWork(request, "A1");
  const list = `/api/v1/projects/${work.project}/work`;
  const selectedId = work.work.split("/").at(-1);
  const other = await request.post(list, {
    data: {
      client_request_id: crypto.randomUUID(),
      goal: "Another task in the recent history window",
      worker_role: "analyst",
      max_model_requests: 3,
      max_input_tokens: 32000,
      max_output_tokens: 6000
    }
  });
  expect(other.status()).toBe(201);
  const otherId = ((await other.json()) as { id: string }).id;
  await expect
    .poll(
      async () =>
        ((await (await request.get(`${list}/${otherId}`)).json()) as { status: string }).status
    )
    .toBe("awaiting_approval");
  let outsideWindow = false;
  let unavailable = false;
  let detailReads = 0;
  await page.route(`**${list}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const data = (await response.json()) as { items: { id: string }[] };
    await route.fulfill({
      response,
      json: {
        items: outsideWindow ? data.items.filter((item) => item.id !== selectedId) : data.items
      }
    });
  });
  await page.route(`**${work.work}`, async (route) => {
    detailReads++;
    if (unavailable)
      return route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
    return route.continue();
  });
  await page.goto(`/?project=${work.project}&view=plan`);
  const manager = page.getByRole("region", { name: "Выполнение задачи Manager", exact: true });
  const history = manager.getByRole("group", { name: "История задач Manager", exact: true });
  const selected = history.getByRole("button", {
    name: /Create result.md with a short complete report/
  });
  await selected.click();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  outsideWindow = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => detailReads).toBeGreaterThan(0);
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  unavailable = true;
  const warning = manager.getByText(
    "Состояние временно недоступно. Работа сохраняется на сервере.",
    { exact: true }
  );
  await expect(warning).toBeVisible();
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  unavailable = false;
  await expect(warning).toBeHidden();
  const control = page.waitForResponse(
    (response) => response.url().endsWith("/control") && response.request().method() === "POST"
  );
  await manager.getByRole("button", { name: "Подтвердить план", exact: true }).click();
  const response = await control;
  expect(response.url()).toContain(`${work.work}/control`);
  expect(response.status()).toBe(200);
  expect(
    ((await (await request.get(`${list}/${otherId}`)).json()) as { status: string }).status
  ).toBe("awaiting_approval");
});

test("a lost create acknowledgement keeps its complete request across model budget refresh", async ({
  page,
  request
}) => {
  const work = await preparedWork(request);
  const list = `/api/v1/projects/${work.project}/work`;
  let changed = false;
  const payloads: {
    client_request_id: string;
    goal: string;
    max_input_tokens: number;
    max_output_tokens: number;
  }[] = [];
  let accepted = "";
  await page.route("**/api/v1/model-runtime", async (route) => {
    const response = await route.fetch();
    const metadata = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      response,
      json: {
        ...metadata,
        mode: "openai-compatible",
        model: changed ? "fixture-window-B" : "fixture-window-A",
        context_window_tokens: changed ? 256000 : 128000,
        max_output_tokens: changed ? 8000 : 4000
      }
    });
  });
  await page.route(`**${list}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    payloads.push(route.request().postDataJSON() as (typeof payloads)[number]);
    if (payloads.length !== 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    accepted = ((await response.json()) as { id: string }).id;
    changed = true;
    await route.fulfill({ status: 503, json: { error: "Lost create acknowledgement" } });
  });
  await page.goto(`/?project=${work.project}&view=plan`);
  const manager = page.getByRole("region", { name: "Выполнение задачи Manager", exact: true });
  await expect(manager.locator(".manager-work-runtime")).toContainText("fixture-window-A");
  const goal = "Keep this accepted request identical after the response is lost";
  await manager.getByLabel("Задача для выполнения", { exact: true }).fill(goal);
  await manager.getByRole("button", { name: "Создать файлы", exact: true }).click();
  await expect(
    manager.getByText("Не удалось выполнить запрос. Проверьте соединение.", { exact: true })
  ).toBeVisible();
  await expect(manager.locator(".manager-work-runtime")).toContainText("fixture-window-B");
  await expect(manager.locator(".manager-work-limits")).toContainText(/384\s*000/);
  const retry = page.waitForResponse(
    (r) => r.url().endsWith(list) && r.request().method() === "POST"
  );
  await manager.getByRole("button", { name: "Создать файлы", exact: true }).click();
  expect((await retry).status()).toBe(201);
  expect(payloads[1]).toEqual(payloads[0]);
  const history = (await (await request.get(list)).json()) as {
    items: { id: string; request: { goal: string } }[];
  };
  expect(history.items.filter((item) => item.request.goal === goal).map((item) => item.id)).toEqual(
    [accepted]
  );
  await expect(manager.locator(".manager-work-limits")).toContainText(/768\s*000/);
  const next = page.waitForResponse(
    (r) => r.url().endsWith(list) && r.request().method() === "POST"
  );
  await manager.getByRole("button", { name: "Создать файлы", exact: true }).click();
  expect((await next).status()).toBe(201);
  expect(payloads[2]!.client_request_id).not.toBe(payloads[0]!.client_request_id);
  expect(payloads[2]).toMatchObject({ max_input_tokens: 768000, max_output_tokens: 24000 });
});

test("successful reads clear network warnings but do not erase failed owner commands", async ({
  page,
  request
}) => {
  const work = await preparedWork(request);
  const base = `/api/v1/projects/${work.project}`;
  const title = "Read recovery plan";
  const created = await request.post(`${base}/work-dags`, {
    data: {
      client_request_id: crypto.randomUUID(),
      title,
      nodes: [{ id: "step", title: "Step", goal: "Create result.md", depends_on: [] }]
    }
  });
  expect(created.status()).toBe(201);
  const graph = (await created.json()) as { id: string };
  let unavailable = false;
  for (const path of [`${base}/work`, `${base}/work-dags`]) {
    await page.route(`**${path}`, (route) =>
      unavailable
        ? route.fulfill({ status: 503, json: { error: "temporary read failure" } })
        : route.continue()
    );
  }
  await page.route(`**${base}/work-dags/${graph.id}/title`, (route) =>
    route.fulfill({ status: 409, json: { error: "STALE_DAG" } })
  );
  await page.clock.install();
  await page.goto(`/?project=${work.project}&view=plan`);
  const manager = page.getByRole("region", { name: "Выполнение задачи Manager", exact: true });
  const plans = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Завершено этапов: 4 / 4", { exact: true })).toBeVisible();
  unavailable = true;
  await page.clock.fastForward(1500);
  const managerWarning = manager.getByText(
    "Состояние временно недоступно. Работа сохраняется на сервере.",
    { exact: true }
  );
  await expect(managerWarning).toBeVisible();
  await expect(plans.getByRole("alert")).toContainText("Не удалось обновить план");
  unavailable = false;
  await page.clock.fastForward(1500);
  await expect(managerWarning).toHaveCount(0);
  await expect(plans.getByRole("alert")).toHaveCount(0);
  await plans.getByRole("button", { name: "Переименовать план", exact: true }).click();
  await plans.getByLabel("Новое название плана", { exact: true }).fill("Rejected rename");
  await plans.getByRole("button", { name: "Сохранить название", exact: true }).click();
  await expect(plans.getByRole("alert")).toBeVisible();
  const commandError = await plans.getByRole("alert").textContent();
  await page.clock.fastForward(3000);
  await expect(plans.getByRole("alert")).toHaveText(commandError!);
  unavailable = true;
  await page.clock.fastForward(1500);
  await expect(managerWarning).toBeVisible();
  await expect(plans.getByRole("alert")).toHaveText(commandError!);
  unavailable = false;
  await page.clock.fastForward(1500);
  await expect(managerWarning).toHaveCount(0);
  await expect(plans.getByRole("alert")).toHaveText(commandError!);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
});

test("runtime read recovers after a temporary failure without a new work version", async ({
  page,
  request
}) => {
  const work = await preparedWork(request);
  let ready = false;
  let reads = 0;
  await page.route(`**${work.runtime}`, (route) => {
    reads++;
    return ready
      ? route.continue()
      : route.fulfill({ status: 503, json: { error: "temporary fixture failure" } });
  });
  await page.clock.install();
  await page.goto(`/?project=${work.project}&view=plan`);
  const progress = page.getByRole("region", { name: "Прогресс Work", exact: true });
  const error = progress.getByText(
    "Не удалось обновить этапы. Сохранённые данные могут быть устаревшими.",
    { exact: true }
  );
  await expect(error).toBeVisible();
  ready = true;
  await page.clock.fastForward(2100);
  await expect(progress.getByText("Завершено этапов: 4 / 4", { exact: true })).toBeVisible();
  await expect(error).toHaveCount(0);
  const recovered = reads;
  await page.clock.fastForward(7000);
  expect(reads).toBe(recovered);
});

test("a new accepted work version refreshes visible progress without a periodic runtime read", async ({
  page,
  request
}) => {
  const work = await preparedWork(request, "A1");
  let reads = 0;
  await page.route(`**${work.runtime}`, (route) => {
    reads++;
    return route.continue();
  });
  await page.goto(`/?project=${work.project}&view=plan`);
  const progress = page.getByRole("region", { name: "Прогресс Work", exact: true });
  await expect(
    progress.getByText("Подтвердите план ниже, чтобы начать создание файлов.", { exact: true })
  ).toBeVisible();
  const before = reads;
  const current = (await (await request.get(work.work)).json()) as { version: number };
  expect(
    (
      await request.post(`${work.work}/control`, {
        data: { version: current.version, action: "approve" }
      })
    ).status()
  ).toBe(200);
  await expect
    .poll(
      async () => {
        const next = (await (await request.get(work.work)).json()) as { status: string };
        return ["blocked", "completed"].includes(next.status);
      },
      { timeout: 15000 }
    )
    .toBe(true);
  const next = (await (await request.get(work.work)).json()) as { status: string };
  await expect(
    progress.getByText(
      next.status === "completed"
        ? "Завершено этапов: 4 / 4"
        : "Сохранение результата ожидает разрешения проекта.",
      { exact: true }
    )
  ).toBeVisible();
  expect(reads).toBeGreaterThan(before);
});

test("hidden progress waits for visibility and reads a changed work version on return", async ({
  page,
  request
}) => {
  const work = await preparedWork(request, "A1");
  let reads = 0;
  const base = `/api/v1/projects/${work.project}`;
  const listUrls = [`${base}/work`, `${base}/work-dags`, "/api/v1/model-runtime"];
  const listReads = new Map(listUrls.map((url) => [url, 0]));
  for (const url of listUrls) {
    await page.route(`**${url}`, (route) => {
      listReads.set(url, listReads.get(url)! + 1);
      return route.continue();
    });
  }
  await page.route(`**${work.runtime}`, (route) => {
    reads++;
    return route.continue();
  });
  await page.clock.install();
  await page.goto(`/?project=${work.project}&view=plan`);
  const progress = page.getByRole("region", { name: "Прогресс Work", exact: true });
  await expect(
    progress.getByText("Подтвердите план ниже, чтобы начать создание файлов.", { exact: true })
  ).toBeVisible();
  const foreground = Promise.all(
    listUrls.map((url) => page.waitForResponse((r) => r.url().endsWith(url)))
  );
  await page.clock.fastForward(1500);
  await foreground;
  expect([...listReads.values()].every((count) => count > 1)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenReads = reads;
  const hiddenLists = [...listReads.entries()];
  const current = (await (await request.get(work.work)).json()) as { version: number };
  expect(
    (
      await request.post(`${work.work}/control`, {
        data: { version: current.version, action: "approve" }
      })
    ).status()
  ).toBe(200);
  await expect
    .poll(
      async () => {
        const next = (await (await request.get(work.work)).json()) as { status: string };
        return ["blocked", "completed"].includes(next.status);
      },
      { timeout: 15000 }
    )
    .toBe(true);
  const latest = (await (await request.get(work.work)).json()) as { status: string };
  const title = "Plan created while its view was hidden";
  expect(
    (
      await request.post(`${base}/work-dags`, {
        data: {
          client_request_id: crypto.randomUUID(),
          title,
          nodes: [{ id: "step", title: "Step", goal: "Create result.md", depends_on: [] }]
        }
      })
    ).status()
  ).toBe(201);
  await page.clock.fastForward(7000);
  const manager = page.getByRole("region", { name: "Выполнение задачи Manager", exact: true });
  expect(reads).toBe(hiddenReads);
  expect([...listReads.entries()]).toEqual(hiddenLists);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    manager
      .getByText(latest.status === "completed" ? "Готово" : "Нужно разрешение", { exact: true })
      .first()
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(
    progress.getByText(
      latest.status === "completed"
        ? "Завершено этапов: 4 / 4"
        : "Сохранение результата ожидает разрешения проекта.",
      { exact: true }
    )
  ).toBeVisible();
  expect(reads).toBeGreaterThan(hiddenReads);
});

test("focus and online wake events share one pending runtime request", async ({
  page,
  request
}) => {
  const work = await preparedWork(request);
  let reads = 0;
  let hold = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${work.runtime}`, async (route) => {
    reads++;
    if (!hold) return route.continue();
    const response = await route.fetch();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* Aborted cleanup request. */
    }
  });
  try {
    await page.goto(`/?project=${work.project}&view=plan`);
    const progress = page.getByRole("region", { name: "Прогресс Work", exact: true });
    await expect(progress.getByText("Завершено этапов: 4 / 4", { exact: true })).toBeVisible();
    const initial = reads;
    hold = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect.poll(() => reads).toBe(initial + 1);
    await page.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reads).toBe(initial + 1);
    const response = page.waitForResponse((r) => r.url().endsWith(work.runtime));
    release();
    expect((await response).status()).toBe(200);
  } finally {
    release();
  }
});
