import { expect, test } from "@playwright/test";

test("shows the project autonomy profile and runtime state without mutating policy", async ({
  page,
  request
}) => {
  const nonce = `${Date.now()}`;
  const created = await request.post("http://127.0.0.1:3100/api/v1/projects", {
    data: {
      initial_message: "Create a project for the autonomy control center browser check.",
      client_message_id: `control-center-e2e-${nonce}`
    }
  });
  expect(created.ok()).toBeTruthy();
  const projectId = ((await created.json()) as { project: { id: string } }).project.id;
  const profileUrl = `http://127.0.0.1:3100/api/v1/projects/${encodeURIComponent(projectId)}/autonomy-profile`;

  const updated = await request.put(profileUrl, {
    data: { base_level: "A3", overrides: [], expected_version: 1 }
  });
  expect(updated.ok()).toBeTruthy();

  await page.goto(`/control-center?project=${encodeURIComponent(projectId)}`);

  await expect(page.getByText("Read-only overview")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Полномочия, подтверждения и аварийное состояние — в одном месте"
    })
  ).toBeVisible();

  const levelMetric = page.locator("article").filter({ hasText: "Уровень" }).first();
  await expect(levelMetric).toContainText("A3");
  await expect(levelMetric).toContainText("profile v2");

  const capabilitiesMetric = page.locator("article").filter({ hasText: "Capabilities" }).first();
  await expect(capabilitiesMetric).toContainText("19");
  await expect(page.locator("[data-mode]")).toHaveCount(19);
  await expect(page.getByText("Нет ожидающих подтверждений.")).toBeVisible();
  await expect(page.getByText("CLEAR", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: /approve|подтверд/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /reject|отклон/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /emergency|аварийн/i })).toHaveCount(0);

  const after = await request.get(profileUrl);
  expect(after.ok()).toBeTruthy();
  expect(
    ((await after.json()) as { profile: { base_level: string; version: number } }).profile
  ).toMatchObject({ base_level: "A3", version: 2 });
});
