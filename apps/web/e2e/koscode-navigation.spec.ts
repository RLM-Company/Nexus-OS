import { expect, test } from "@playwright/test";

/** Koscode has a project/session sidebar distinct from the ordinary chat. */
test("Koscode sidebar groups sessions by project without duplicate chat navigation", async ({
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
  await expect(sidebar.getByRole("button", { name: "Новая сессия", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Чаты", exact: true })).toHaveCount(0);
  await expect(sidebar.getByRole("button", { name: "Создать проект Koscode" })).toBeVisible();
  await expect(panel.getByText("Проект задач")).toBeVisible();
  await expect(panel.getByRole("link", { name: /Задачи и проверки/ })).toHaveAttribute(
    "href",
    `/code-agent?project=${projectId}`
  );
  await sidebar
    .getByRole("textbox", { name: "Поиск сессий и проектов Koscode" })
    .fill("несуществующая-сессия");
  await expect(panel.getByText("Ничего не найдено")).toBeVisible();
  await sidebar.getByRole("button", { name: "Очистить поиск Koscode" }).click();
  await expect(panel.getByText("Проект задач", { exact: true })).toBeVisible();
  await page.screenshot({ path: "../../qa/koscode-sidebar-desktop.png", fullPage: true });
});

test("ordinary Kosmora keeps its chat navigation", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("kosmora:profile-onboarding.v1", "done"));
  await page.goto("/?mode=kosmora");
  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toHaveAttribute("data-space", "kosmora");
  await expect(sidebar.getByRole("button", { name: "Новый чат", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("region", { name: "Сессии Koscode" })).toHaveCount(0);
});
