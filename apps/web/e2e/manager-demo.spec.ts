import { expect, test } from "@playwright/test";

test("persists the visible Manager demo plan through reload and executes it explicitly", async ({
  page
}) => {
  const goal = "Подготовь план улучшения документации проекта";
  await page.goto("/");
  await page.getByLabel("Опишите результат, который хотите получить").fill(goal);
  const createdProject = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/projects") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Запустить" }).click();
  const created = await createdProject;
  const createdText = await created.text();
  expect(created.status(), createdText).toBe(201);
  const createdBody = JSON.parse(createdText) as { project: { id: string } };
  await expect(page.getByRole("status")).toHaveText(/Ответ получен/);
  await page.getByRole("tab", { name: "План" }).click();
  await expect(page).toHaveURL(new RegExp(`project=${createdBody.project.id}&view=plan`));

  const planRequest = page.waitForResponse(
    (response) =>
      response.url().includes("/manager-demo-runs") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Подготовить Manager plan" }).click();
  const prepared = await planRequest;
  expect(prepared.status(), await prepared.text()).toBe(201);
  await expect(page.getByText("План готов к запуску")).toBeVisible();
  await expect(page.getByText("Synthetic/read-only demo:")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: goal })).toBeVisible();
  await expect(page.getByRole("tab", { name: "План" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("План готов к запуску")).toBeVisible();
  await expect(page.getByRole("button", { name: "Запустить безопасный шаг" })).toBeVisible();

  const executeRequest = page.waitForResponse(
    (response) => response.url().endsWith("/execute") && response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Запустить безопасный шаг" }).click();
  const completed = await executeRequest;
  expect(completed.status(), await completed.text()).toBe(200);
  await expect(page.getByText("Завершён с checkpoint")).toBeVisible();
  await expect(
    page.getByText("Демо-проверка контекста выполнена synthetic/read-only executor-ом.")
  ).toBeVisible();
  await expect(page.getByText("Checkpoint сохранён")).toBeVisible();
});
