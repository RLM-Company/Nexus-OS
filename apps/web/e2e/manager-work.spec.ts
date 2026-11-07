import { expect, test } from "@playwright/test";

for (const early of [false, true]) {
  test(`local Work result returns to the originating request${early ? " before acknowledgement" : " after acknowledgement"}`, async ({
    page,
    request
  }) => {
    const created = await request.post("/api/v1/projects", {
      data: {
        initial_message: "Возврат результата Koswork",
        client_message_id: crypto.randomUUID()
      }
    });
    expect(created.status()).toBe(201);
    const { project } = (await created.json()) as { project: { id: string } };
    await request.put(`/api/v1/projects/${project.id}/autonomy-profile`, {
      data: { base_level: "A2", overrides: [], expected_version: 1 }
    });
    await page.addInitScript(
      ({ projectId, early }) => {
        let listener: ((value: unknown) => void) | null = null;
        const receipt = "8d199edd-1b74-445e-bc6b-6fe26039c326";
        const summary = '<img src=x onerror="window.injected=true"> ' + "Результат".repeat(100);
        const emit = (requestId = receipt, project = projectId) =>
          listener?.({
            request_id: requestId,
            project,
            result: { source: "local_agent_report", status: "completed", summary }
          });
        Object.assign(window, {
          emitWorkResult: emit,
          kosmoraDesktopWork: {
            onResult: (callback: (value: unknown) => void) => {
              listener = callback;
              return () => {
                listener = null;
              };
            },
            open: () => {
              if (early) emit();
              return Promise.resolve({ ok: true, request_id: receipt });
            }
          }
        });
      },
      { projectId: project.id, early }
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?project=${project.id}&view=plan`);
    const panel = page.getByRole("region", { name: "Выполнение задачи Manager" });
    const goal = panel.getByLabel("Задача для выполнения");
    const outcome = panel.getByRole("status", { name: "Результат локальной задачи" });
    await goal.fill("Подготовь итог задачи");
    await panel.getByRole("button", { name: "Выполнить в Koswork", exact: true }).click();
    if (!early) {
      await expect(outcome).toHaveCount(0);
      await page.evaluate(() => {
        const target = window as Window & {
          emitWorkResult: (id?: string, project?: string) => void;
        };
        target.emitWorkResult("f841cc73-b83f-4e5a-88cf-55cf722a9d74");
        target.emitWorkResult(undefined, "another-project");
      });
      await expect(outcome).toHaveCount(0);
      await page.evaluate(() =>
        (window as Window & { emitWorkResult: () => void }).emitWorkResult()
      );
    }
    await expect(outcome).toContainText("Получен результат локальной задачи.");
    await expect(outcome).toContainText('<img src=x onerror="window.injected=true">');
    await expect(outcome.locator("img")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await goal.fill("Другая задача");
    await expect(outcome).toHaveCount(0);
    await page.evaluate(() => (window as Window & { emitWorkResult: () => void }).emitWorkResult());
    await expect(outcome).toHaveCount(0);
    const work = await request.get(`/api/v1/projects/${project.id}/work`);
    expect(((await work.json()) as { items: unknown[] }).items).toHaveLength(0);
  });
}

test("desktop Work entry prefers the unified native task and only transfers its goal", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Единая задача Koswork", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  await request.put(`/api/v1/projects/${project.id}/autonomy-profile`, {
    data: { base_level: "A2", overrides: [], expected_version: 1 }
  });
  await page.addInitScript(() => {
    const target = window as Window & {
      kosmoraDesktopWork: unknown;
      kosmoraDesktopComputer: unknown;
    };
    target.kosmoraDesktopWork = {
      open: (input: unknown) => {
        document.documentElement.dataset.workRequest = JSON.stringify(input);
        return Promise.resolve({ ok: true });
      }
    };
    target.kosmoraDesktopComputer = {
      open: () => {
        throw new Error("Standalone computer opener must not replace unified Work");
      }
    };
  });
  await page.goto(`/?project=${project.id}&view=plan`);
  const panel = page.getByRole("region", { name: "Выполнение задачи Manager" }),
    goal = "Найди сведения и сохрани отчёт с источниками";
  await panel.getByLabel("Задача для выполнения").fill(goal);
  await panel.getByRole("button", { name: "Выполнить в Koswork", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-work-request",
    JSON.stringify({ project: project.id, goal })
  );
  expect(
    (
      (await (await request.get(`/api/v1/projects/${project.id}/work`)).json()) as {
        items: unknown[];
      }
    ).items
  ).toHaveLength(0);
});

test("desktop computer entry transfers the goal to native consent without starting Work", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Проект для ПК", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  await request.put(`/api/v1/projects/${project.id}/autonomy-profile`, {
    data: { base_level: "A2", overrides: [], expected_version: 1 }
  });
  await page.addInitScript(() => {
    (window as Window & { kosmoraDesktopComputer: unknown }).kosmoraDesktopComputer = {
      open: (input: unknown) => {
        document.documentElement.dataset.computerRequest = JSON.stringify(input);
        return Promise.resolve({ ok: true });
      }
    };
  });
  await page.goto(`/?project=${project.id}&view=plan`);
  const panel = page.getByRole("region", { name: "Выполнение задачи Manager" });
  const goal = "Открой Блокнот и напиши план встречи";
  await panel.getByLabel("Задача для выполнения").fill(goal);
  await panel.getByRole("button", { name: "Выполнить на компьютере", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-computer-request",
    JSON.stringify({ project: project.id, goal })
  );
  const works = await request.get(`/api/v1/projects/${project.id}/work`);
  expect(((await works.json()) as { items: unknown[] }).items).toHaveLength(0);
});

test("creates guarded mock files, survives reload and downloads the result", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Создай документ о запуске проекта",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const { project } = (await created.json()) as { project: { id: string } };
  const profile = await request.put("/api/v1/projects/" + project.id + "/autonomy-profile", {
    data: { base_level: "A2", overrides: [], expected_version: 1 }
  });
  expect(profile.status()).toBe(200);
  await page.goto("/?project=" + project.id + "&view=plan");
  const panel = page.getByRole("region", { name: "Выполнение задачи Manager" });
  await expect(panel.getByText(/Демонстрационный режим/)).toBeVisible();
  await panel.getByLabel("Задача для выполнения").fill("Создай краткий документ с планом запуска");
  await panel.getByRole("button", { name: "Создать файлы", exact: true }).click();
  await expect(panel.getByRole("link", { name: "result.md", exact: true })).toBeVisible();
  const href = await panel
    .getByRole("link", { name: "result.md", exact: true })
    .getAttribute("href");
  expect(href).toBeTruthy();
  const downloaded = await request.get(href!);
  expect(downloaded.headers()["content-disposition"]).toContain("attachment");
  expect(await downloaded.text()).toContain("Живая модель не вызывалась");
  await page.reload();
  await expect(panel.getByRole("link", { name: "result.md", exact: true })).toBeVisible();
  const work = await request.get("/api/v1/projects/" + project.id + "/work");
  const { items } = (await work.json()) as { items: { status: string; model_requests: number }[] };
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({ status: "completed", model_requests: 3 });

  await panel.getByLabel("Задача для выполнения").fill("Создай второй документ для проекта");
  await panel.getByRole("button", { name: "Создать файлы", exact: true }).click();
  const history = panel.getByRole("group", { name: "История задач Manager" });
  await expect(history.getByRole("button")).toHaveCount(2);
  await expect(panel.getByRole("link", { name: "result.md", exact: true })).toBeVisible();
  await history.getByRole("button", { name: /краткий документ с планом запуска/ }).click();
  await expect(panel.getByRole("link", { name: "result.md", exact: true })).toHaveAttribute(
    "href",
    href!
  );
  await page.reload();
  await expect(history.getByRole("button")).toHaveCount(2);
  await history.getByRole("button", { name: /краткий документ с планом запуска/ }).click();
  await expect(panel.getByRole("link", { name: "result.md", exact: true })).toHaveAttribute(
    "href",
    href!
  );
  await page.route("**/api/v1/operations/status", (route) =>
    route.fulfill({ json: { process_stop: { active: true } } })
  );
  await expect(panel.getByTestId("manager-execution-gate")).toContainText("для всех проектов");
  await expect(panel.getByRole("button", { name: "Создать файлы", exact: true })).toBeDisabled();
  await expect(panel.getByRole("link", { name: "result.md", exact: true })).toBeVisible();
  expect((await request.get(href!)).status()).toBe(200);
});
