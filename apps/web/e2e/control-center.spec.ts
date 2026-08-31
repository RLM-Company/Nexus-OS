import { expect, test } from "@playwright/test";

test("previews an authority diff before applying an autonomy profile change", async ({
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

  await expect(page.getByText("Preview before apply")).toBeVisible();
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

  await page.getByRole("button", { name: "Выбрать уровень A4" }).click();
  const authorityDiff = page.getByRole("region", {
    name: "Проверка перед изменением уровня"
  });
  await expect(authorityDiff).toBeVisible();
  await expect(authorityDiff).toContainText("A3 → A4");
  await expect(authorityDiff).toContainText("finance.spend");
  await expect(authorityDiff).toContainText("CONFIRM");
  await expect(authorityDiff).toContainText("AUTONOMOUS");

  const beforeApply = await request.get(profileUrl);
  expect(beforeApply.ok()).toBeTruthy();
  expect(
    ((await beforeApply.json()) as { profile: { base_level: string; version: number } }).profile
  ).toMatchObject({ base_level: "A3", version: 2 });

  await page.getByLabel("Я проверил изменения полномочий и хочу применить их.").check();
  await page.getByRole("button", { name: "Применить A4" }).click();

  await expect(levelMetric).toContainText("A4");
  await expect(levelMetric).toContainText("profile v3");
  await expect(page.getByRole("status")).toContainText("Уровень автономии изменён на A4");

  await expect(page.getByRole("button", { name: /approve|подтверд/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /reject|отклон/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /emergency|аварийн/i })).toHaveCount(0);

  const afterApply = await request.get(profileUrl);
  expect(afterApply.ok()).toBeTruthy();
  expect(
    ((await afterApply.json()) as { profile: { base_level: string; version: number } }).profile
  ).toMatchObject({ base_level: "A4", version: 3 });
});
