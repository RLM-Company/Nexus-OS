import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const createProject = async (request: APIRequestContext, prefix: string): Promise<string> => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for a mobile owner-surface layout check.",
      client_message_id: `${prefix}-${Date.now()}`
    }
  });

  expect(created.ok()).toBeTruthy();
  const body = (await created.json()) as { project: { id: string } };
  return body.project.id;
};

const expectNoHorizontalOverflow = async (page: Page): Promise<void> => {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
  ).toBe(true);
};

test("Control Center stays usable at 390x844", async ({ page, request }) => {
  const projectId = await createProject(request, "control-center-mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  await expect(page.getByText("Guarded owner actions")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Полномочия, подтверждения и аварийное состояние — в одном месте"
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Выбрать уровень A0" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Agent Studio stays usable at 390x844", async ({ page, request }) => {
  const projectId = await createProject(request, "agent-studio-mobile");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/agent-studio?project=${encodeURIComponent(projectId)}`);

  await expect(page.getByText("Versioned catalog")).toBeVisible();
  await expect(page.getByRole("heading", { name: /Agent Studio/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
