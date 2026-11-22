import { expect, test } from "@playwright/test";

/** Stage-three owner card: Koscode sidebar groups sessions by project and shows
 * active tasks; each group links to the run state/diff/check workspace. */
test("Koscode sidebar groups sessions by project and exposes active tasks", async ({
  page,
  request
}) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("kosmora:profile-onboarding.v1", "done");
    } catch {
      /* Storage may be unavailable. */
    }
  });
  const created = await request.post("/api/v1/projects/empty", {
    data: { title: "Проект задач", client_project_id: crypto.randomUUID() }
  });
  expect(created.ok()).toBe(true);
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const chat = await request.post("/api/v1/chats", {
    data: {
      initial_message: "Сессия Koscode",
      client_message_id: crypto.randomUUID(),
      mode: "coscode",
      project_id: projectId
    }
  });
  expect(chat.ok(), await chat.text()).toBe(true);

  await page.goto("/?mode=coscode");
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toHaveAttribute("data-space", "coscode");
  const panel = sidebar.getByRole("region", { name: "Сессии Koscode" });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Активные задачи");
  await expect(panel.getByText("Проект задач")).toBeVisible();
  await expect(panel.getByRole("link", { name: /Задачи и проверки/ })).toHaveAttribute(
    "href",
    `/code-agent?project=${projectId}`
  );
});
