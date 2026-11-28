import { expect, test } from "@playwright/test";

test("reopens an exact saved Stars mission and never substitutes a recent mission for a broken link", async ({
  page,
  request
}) => {
  const projectResponse = await request.post("/api/v1/projects/empty", {
    data: { title: "Stars task observation", client_project_id: crypto.randomUUID() }
  });
  expect(projectResponse.status()).toBe(201);
  const { project } = (await projectResponse.json()) as { project: { id: string } };
  const marker = crypto.randomUUID().slice(0, 8);
  const one = `Сверить поставщиков ${marker}`;
  const two = `Проверить смету ${marker}`;
  async function create(goal: string) {
    const response = await request.post("/api/v1/stars/missions", {
      data: { client_request_id: crypto.randomUUID(), team_scope: project.id, goal }
    });
    expect(response.ok()).toBe(true);
    return response.json() as Promise<{ id: string }>;
  }
  const first = await create(one);
  await create(two);
  await page.goto(`/stars?mission=${first.id}`);
  await expect(page.getByText(one, { exact: true })).toBeVisible();
  await expect(page.getByText(two, { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(one, { exact: true })).toBeVisible();
  await page.goto(`/stars?mission=${crypto.randomUUID()}`);
  await expect(page.getByText("Сохранённая миссия недоступна.", { exact: true })).toBeVisible();
  await expect(page.getByText(one, { exact: true })).toHaveCount(0);
  await expect(page.getByText(two, { exact: true })).toHaveCount(0);
});
