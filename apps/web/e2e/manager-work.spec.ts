import { expect, test } from "@playwright/test";

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
  const resultPreview = panel.getByRole("tabpanel", { name: "Предпросмотр result.md" });
  await expect(resultPreview).toContainText("Живая модель не вызывалась");
  await expect(panel.getByRole("region", { name: "Результаты задачи Manager" })).toContainText(
    "Текстовый предпросмотр · без выполнения кода"
  );
  const phases = panel.getByRole("list", { name: "Этапы задачи Manager" });
  await expect(phases.getByRole("listitem")).toHaveCount(5);
  await expect(phases.locator('[data-state="done"]')).toHaveCount(5);
  await expect(phases).toContainText("План");
  await expect(phases).toContainText("Черновик");
  await expect(phases).toContainText("Проверка");
  await expect(phases).toContainText("Подготовка");
  await expect(phases).toContainText("Готово");
  await expect(panel.locator('[aria-label="Состояние выполнения Manager"]')).toContainText(
    "Аналитик"
  );
  await expect(panel.locator('[aria-label="Состояние выполнения Manager"]')).toContainText("3 / 3");
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
  const rememberedWork = history.getByRole("button", {
    name: /краткий документ с планом запуска/
  });
  await expect(rememberedWork).toHaveAttribute("aria-pressed", "true");
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
