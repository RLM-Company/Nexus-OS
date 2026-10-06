import { expect, test, type APIRequestContext } from "@playwright/test";

async function createProject(request: APIRequestContext): Promise<string> {
  const response = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Подготовь файл и дождись разрешения на сохранение",
      client_message_id: crypto.randomUUID()
    }
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { project: { id: string } }).project.id;
}

test("surfaces Manager Work that needs owner attention and keeps it live", async ({
  page,
  request
}) => {
  const projectId = await createProject(request);
  let needsAttention = true;
  const work = {
    id: "attention-work",
    version: 4,
    status: "blocked",
    stage: "publish",
    pause_requested: false,
    model_requests: 2,
    error_code: "WAITING_CONFIRMATION",
    confirmation_id: "confirmation-1",
    plan: {
      summary: "Подготовить результат",
      instructions: "Создать файл и сохранить его в проекте",
      complexity: "simple",
      needs_critic: false
    },
    draft: { files: [{ name: "result.md", content: "# Result" }] },
    review: null,
    events: [
      {
        sequence: 1,
        stage: "publish",
        message: "Сохранение файлов ожидает разрешения",
        at: "2026-10-06T07:00:00.000Z"
      }
    ],
    request: { goal: "Подготовь итоговый файл" },
    updated_at: "2026-10-06T07:00:00.000Z"
  };

  await page.route(`**/api/v1/projects/${projectId}/work`, (route) =>
    route.fulfill({ json: { items: needsAttention ? [work] : [] } })
  );

  await page.goto(`/?project=${projectId}&view=project`);

  const facts = page.getByRole("region", { name: "Информация о проекте" });
  const attention = page.getByRole("region", { name: "Требуется внимание владельца" });

  await expect(facts.getByText("1 требует внимания", { exact: true })).toBeVisible();
  await expect(attention).toContainText("Manager Work · 1");
  await expect(attention).toContainText("Подготовь итоговый файл");
  await expect(attention).toContainText("Сохранение файлов · Нужно разрешение");
  await expect(attention).toContainText("Сохранение файлов ожидает разрешения");

  needsAttention = false;
  await expect(facts.getByText("Без внимания", { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(attention).toHaveCount(0);

  needsAttention = true;
  await expect(attention).toBeVisible({ timeout: 5_000 });
  await attention.getByRole("button", { name: "Открыть задачу", exact: true }).click();

  await expect(page).toHaveURL(new RegExp(`project=${projectId}.*view=plan`));
  await expect(page.getByRole("region", { name: "Выполнение задачи Manager" })).toBeVisible();
  await expect(page.getByTestId("manager-work-stage")).toHaveText("Сохранение файлов");
});
