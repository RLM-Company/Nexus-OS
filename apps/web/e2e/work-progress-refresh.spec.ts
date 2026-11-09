import { expect, test, type APIRequestContext } from "@playwright/test";

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
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenReads = reads;
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
  await page.clock.fastForward(1500);
  const manager = page.getByRole("region", { name: "Выполнение задачи Manager", exact: true });
  await expect(
    manager
      .getByText(latest.status === "completed" ? "Готово" : "Нужно разрешение", { exact: true })
      .first()
  ).toBeVisible();
  expect(reads).toBe(hiddenReads);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible"
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
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
