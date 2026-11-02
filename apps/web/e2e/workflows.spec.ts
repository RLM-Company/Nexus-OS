import { expect, test } from "@playwright/test";
import type { WorkflowDefinition } from "@cosmora/contracts";
test("document scenario captures a real project file, restores a version and imports a portable copy", async ({
  page,
  request
}) => {
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Версии и документы", client_message_id: crypto.randomUUID() }
  });
  expect(created.status()).toBe(201);
  const project = ((await created.json()) as { project: { id: string } }).project.id,
    base = `/api/v1/projects/${project}/workflows`,
    documents = `/api/v1/projects/${project}/document-library`;
  const upload = await request.post(documents, {
    headers: { "content-type": "application/octet-stream", "x-kosmora-file-name": "facts.txt" },
    data: Buffer.from("SOURCE FACTS 42")
  });
  expect(upload.status()).toBe(201);
  const file = (await upload.json()) as { id: string };
  expect(
    (
      await request.put(documents + "/" + file.id + "/index", {
        data: { pages: [{ page: null, text: "SOURCE FACTS 42" }] }
      })
    ).status()
  ).toBe(200);
  await page.goto(`/?project=${project}&view=plan`);
  await page.getByText("Сценарии Koswork", { exact: true }).click();
  const panel = page.getByRole("region", { name: "Сохранённые сценарии Koswork", exact: true });
  await expect(panel.getByLabel("Шаблон сценария")).toContainText("Отчёт по документу");
  await panel.getByLabel("Шаблон сценария").selectOption("document-report");
  await panel.getByRole("button", { name: "Сохранить сценарий", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Сценарий сохранён");
  const d = ((await (await request.get(base)).json()) as { items: WorkflowDefinition[] }).items[0]!;
  await panel
    .getByLabel(d.parameters.find((p) => p.type === "file")!.label, { exact: true })
    .selectOption(file.id);
  await panel
    .getByLabel(d.parameters.find((p) => p.type === "text")!.label, { exact: true })
    .fill("Проверить факты");
  await panel.getByRole("button", { name: "Подготовить план сценария", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("План подготовлен");
  const plans = (await (await request.get(`/api/v1/projects/${project}/work-dags`)).json()) as {
    items: { workflow_context: { materials: { attachments: { content: string }[] } } }[];
  };
  expect(plans.items[0]!.workflow_context.materials.attachments[0]!.content).toContain(
    "SOURCE FACTS 42"
  );
  await panel.getByRole("button", { name: "Редактировать", exact: true }).click();
  await panel.getByLabel("Название сценария", { exact: true }).fill("Отчёт v2");
  await panel.getByRole("button", { name: "Сохранить сценарий", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Отчёт v2 · версия 2", exact: true })
  ).toBeVisible();
  await panel.getByRole("button", { name: "Версии", exact: true }).click();
  await panel
    .getByRole("listitem")
    .filter({ hasText: "Версия 1:" })
    .getByRole("button", { name: "Открыть как новую редакцию" })
    .click();
  await expect(panel.getByLabel("Название сценария", { exact: true })).toHaveValue(
    "Отчёт по документу"
  );
  await panel.getByRole("button", { name: "Сохранить сценарий", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Отчёт по документу · версия 3", exact: true })
  ).toBeVisible();
  const portable = (await (await request.get(base + "/" + d.id + "/package")).json()) as unknown;
  await panel.getByLabel("Импорт сценария", { exact: true }).setInputFiles({
    name: "workflow.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(portable))
  });
  await expect(panel.getByLabel("Название сценария", { exact: true })).toBeVisible();
  await panel.getByLabel("Название сценария", { exact: true }).fill("Импортированный отчёт");
  await panel.getByRole("button", { name: "Сохранить сценарий", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Импортированный отчёт · версия 1", exact: true })
  ).toBeVisible();
  expect(((await (await request.get(base)).json()) as { items: unknown[] }).items).toHaveLength(2);
});
test("reusable scenario survives lost save/run responses, executes with real HTTP and downloads files", async ({
  page,
  request
}) => {
  test.setTimeout(90000);
  const response = await request.post("/api/v1/projects", {
    data: { initial_message: "Сценарии E2E", client_message_id: crypto.randomUUID() }
  });
  expect(response.status()).toBe(201);
  const id = ((await response.json()) as { project: { id: string } }).project.id,
    base = `/api/v1/projects/${id}/workflows`;
  expect(
    (
      await request.put(`/api/v1/projects/${id}/autonomy-profile`, {
        data: { base_level: "A2", overrides: [], expected_version: 1 }
      })
    ).status()
  ).toBe(200);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`/?project=${id}&view=plan`);
  const plan = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await plan.getByText("Сценарии Koswork", { exact: true }).click();
  const scenarios = plan.getByRole("region", { name: "Сохранённые сценарии Koswork", exact: true });
  await expect(scenarios.getByLabel("Шаблон сценария")).toContainText("Текст в рабочие материалы");
  await scenarios.getByLabel("Шаблон сценария").selectOption("text-pack");
  await scenarios.getByLabel("Название сценария", { exact: true }).fill("Мой повторяемый сценарий");
  let saves = 0;
  await page.route("**/workflows", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    saves++;
    if (saves !== 1) return route.continue();
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost save acknowledgement" } });
  });
  await scenarios.getByRole("button", { name: "Сохранить сценарий", exact: true }).click();
  await expect(scenarios.getByRole("alert")).toBeVisible();
  await expect(scenarios.getByLabel("Название сценария", { exact: true })).toHaveValue(
    "Мой повторяемый сценарий"
  );
  await scenarios.getByRole("button", { name: "Сохранить сценарий", exact: true }).click();
  await expect(scenarios.getByRole("status")).toContainText("Сценарий сохранён");
  const definitions = ((await (await request.get(base)).json()) as { items: WorkflowDefinition[] })
    .items;
  expect(definitions).toHaveLength(1);
  const d = definitions[0]!;
  await scenarios
    .getByLabel(d.parameters[0]!.label, { exact: true })
    .fill("Обновление Kosmora: подготовить краткое резюме и письмо команде.");
  let starts = 0;
  await page.route("**/workflows/*/runs", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    starts++;
    if (starts !== 1) return route.continue();
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost start acknowledgement" } });
  });
  await scenarios.getByRole("button", { name: "Подготовить план сценария", exact: true }).click();
  await expect(scenarios.getByRole("alert")).toBeVisible();
  await scenarios.getByRole("button", { name: "Подготовить план сценария", exact: true }).click();
  await expect(scenarios.getByRole("status")).toContainText("План подготовлен");
  expect(
    ((await (await request.get(base + "/" + d.id + "/runs")).json()) as { items: unknown[] }).items
  ).toHaveLength(1);
  expect(
    ((await (await request.get(`/api/v1/projects/${id}/work`)).json()) as { items: unknown[] })
      .items
  ).toHaveLength(0);
  await scenarios
    .getByLabel("Начать выполнение сразу; запросы модели расходуют токены", { exact: true })
    .check();
  await scenarios.getByRole("button", { name: "Запустить сценарий", exact: true }).click();
  await expect(
    scenarios.getByRole("link", { name: "Скачать результаты", exact: true })
  ).toBeVisible({ timeout: 60000 });
  const download = await request.get(
    (await scenarios
      .getByRole("link", { name: "Скачать результаты", exact: true })
      .getAttribute("href"))!
  );
  expect(download.status()).toBe(200);
  expect((await download.body()).subarray(0, 2).toString()).toBe("PK");
  await scenarios.getByRole("button", { name: "Архивировать сценарий", exact: true }).click();
  await expect(
    scenarios
      .getByRole("button", { name: "Подготовить план сценария", exact: true })
      .or(scenarios.getByRole("button", { name: "Запустить сценарий", exact: true }))
  ).toBeDisabled();
  await scenarios.getByRole("button", { name: "Восстановить сценарий", exact: true }).click();
  await expect(
    scenarios.getByRole("button", { name: "Запустить сценарий", exact: true })
  ).toBeEnabled();
  await page.reload();
  await plan.getByText("Сценарии Koswork", { exact: true }).click();
  await scenarios.getByRole("button", { name: /Мой повторяемый сценарий · v1/ }).click();
  await expect(
    scenarios.getByRole("link", { name: "Скачать результаты", exact: true })
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});
