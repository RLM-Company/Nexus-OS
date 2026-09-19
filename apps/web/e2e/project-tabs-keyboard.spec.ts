import { expect, test } from "@playwright/test";

test("supports roving keyboard focus across project tabs", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for keyboard tab navigation coverage.",
      client_message_id: `project-tabs-keyboard-${Date.now()}`
    }
  });
  expect(created.ok()).toBeTruthy();

  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  await page.goto(`/?project=${encodeURIComponent(projectId)}&view=chat`);

  const tabs = page.getByRole("tablist", { name: "Разделы проекта" });
  const chat = tabs.getByRole("tab", { name: "Чат" });
  const plan = tabs.getByRole("tab", { name: "План" });
  const project = tabs.getByRole("tab", { name: "Проект" });
  const context = tabs.getByRole("tab", { name: "Контекст" });

  await expect(chat).toHaveAttribute("aria-selected", "true");
  await expect(chat).toHaveAttribute("tabindex", "0");
  await expect(plan).toHaveAttribute("tabindex", "-1");

  await chat.focus();
  await page.keyboard.press("ArrowRight");
  await expect(plan).toBeFocused();
  await expect(plan).toHaveAttribute("aria-selected", "true");
  await expect(chat).toHaveAttribute("tabindex", "-1");
  await expect(page).toHaveURL(new RegExp(`view=plan`));

  await page.keyboard.press("End");
  await expect(context).toBeFocused();
  await expect(context).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(new RegExp(`view=context`));

  await page.keyboard.press("Home");
  await expect(chat).toBeFocused();
  await expect(chat).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(context).toBeFocused();
  await expect(context).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(project).toBeFocused();
  await expect(project).toHaveAttribute("aria-selected", "true");
});
