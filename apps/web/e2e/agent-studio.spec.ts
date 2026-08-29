import { expect, test } from "@playwright/test";

test("shows a read-only Agent Studio control surface", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create an empty project for the Agent Studio UI check.",
      client_message_id: `agent-studio-e2e-${Date.now()}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const body = (await created.json()) as { project: { id: string } };

  await page.goto(`/agent-studio?project=${encodeURIComponent(body.project.id)}`);

  await expect(
    page.getByRole("heading", { name: "Структура агентов под контролем владельца" })
  ).toBeVisible();
  await expect(page.getByText("Только просмотр · агенты не запущены")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Предложенные агенты" })).toBeVisible();
  await expect(page.getByText("В этом проекте пока нет предложенных агентов.")).toBeVisible();
  await expect(page.getByRole("button", { name: /актив/i })).toHaveCount(0);
});
