import { expect, test } from "@playwright/test";

test("normalizes an invalid project view route back to chat", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for invalid project-view route coverage.",
      client_message_id: `invalid-project-view-${Date.now()}`
    }
  });
  expect(created.ok()).toBeTruthy();

  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  await page.goto(`/?project=${encodeURIComponent(projectId)}&view=javascript%3Ainvalid`);

  const chatTab = page.getByRole("tab", { name: "Чат" });
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Главный чат проекта" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`project=${projectId}&view=chat$`));

  await page.reload();
  await expect(chatTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(new RegExp(`project=${projectId}&view=chat$`));
});
