import { expect, test } from "@playwright/test";

test("Control Center stays usable at 390x844", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for a mobile Control Center layout check.",
      client_message_id: `control-center-mobile-${Date.now()}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  await expect(
    page.getByRole("heading", {
      name: "Полномочия, подтверждения и аварийное состояние — в одном месте"
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Выбрать уровень A0" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});

test("Agent Studio stays usable at 390x844", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for a mobile Agent Studio layout check.",
      client_message_id: `agent-studio-mobile-${Date.now()}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/agent-studio?project=${encodeURIComponent(projectId)}`);

  await expect(page.getByText("Versioned catalog")).toBeVisible();
  await expect(page.getByText("Agent Studio", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
});
