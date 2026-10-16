import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type { WorkDag } from "@cosmora/contracts";

async function project(request: APIRequestContext) {
  const r = await request.post("/api/v1/projects/empty", {
    data: { title: "Work reuse " + randomUUID().slice(0, 8), client_project_id: randomUUID() }
  });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { project: { id: string } }).project.id;
}
const nodes = [
  { id: "a", title: "Бриф", goal: "Составить бриф", requires_critic: true, depends_on: [] },
  { id: "b", title: "Документ", goal: "Использовать бриф", depends_on: ["a"] }
];

test("Work pins the selected Skill and shows literal accepted plan instructions after catalog deletion", async ({
  page,
  request
}) => {
  const id = await project(request);
  const sr = await request.post("/api/v1/owner-skills", {
    data: {
      name: "Research " + randomUUID().slice(0, 8),
      summary: "Sources",
      instructions: "<script>window.workSkillInjected=true</script> PINNED_WORK"
    }
  });
  const skill = (await sr.json()) as { id: string; name: string };
  await page.goto(`/?project=${id}&view=plan`);
  await page.getByText("Skills Work", { exact: true }).click();
  const selector = page.getByRole("group", { name: "Skills Work проекта", exact: true });
  await selector.getByRole("checkbox", { name: new RegExp(skill.name) }).check();
  await selector.getByRole("button", { name: "Сохранить Skills", exact: true }).click();
  await expect(selector.getByRole("status")).toHaveText("Skills сохранены.");
  const r = await request.post(`/api/v1/projects/${id}/work-dags`, {
    data: { client_request_id: randomUUID(), title: "Снимок", nodes }
  });
  expect(r.status()).toBe(201);
  expect(
    (
      await request.delete(`/api/v1/owner-skills/${skill.id}`, { data: { expected_version: 1 } })
    ).status()
  ).toBe(204);
  await page.reload();
  const snapshot = page.getByLabel("Skills этого плана", { exact: true });
  await snapshot.locator("summary").click();
  await expect(snapshot.locator("pre")).toContainText(
    "<script>window.workSkillInjected=true</script>"
  );
  expect(await page.evaluate(() => Object.hasOwn(window, "workSkillInjected"))).toBe(false);
});

test("copies a plan once after a lost acknowledgement and leaves it ready for separate execution", async ({
  page,
  request
}) => {
  const id = await project(request),
    base = `/api/v1/projects/${id}/work-dags`;
  const r = await request.post(base, {
    data: { client_request_id: randomUUID(), title: "Исходный план", nodes }
  });
  const source = (await r.json()) as WorkDag;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByRole("button", { name: "Создать копию плана", exact: true }).click();
  await panel.getByLabel("Название копии", { exact: true }).fill("Независимая копия");
  let posts = 0;
  await page.route("**/work-dags/*/clone", async (route) => {
    posts++;
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost acknowledgement" } });
  });
  await panel.getByRole("button", { name: "Сохранить копию", exact: true }).click();
  await expect(
    panel.getByRole("heading", { name: "Независимая копия", exact: true })
  ).toBeVisible();
  await expect(panel.getByRole("form", { name: "Копия плана", exact: true })).toHaveCount(0);
  const items = ((await (await request.get(base)).json()) as { items: WorkDag[] }).items;
  expect(items).toHaveLength(2);
  expect(posts).toBe(1);
  const copy = items.find((g) => g.id !== source.id)!;
  expect(copy.nodes.map((n) => n.status)).toEqual(["pending", "blocked"]);
  expect(copy.nodes.every((n) => n.attempts.length === 0 && n.artifacts.length === 0)).toBe(true);
  expect(copy.execution).toBeUndefined();
});

test("previews portable JSON literally, rejects a cycle, imports once and exports only tasks on a narrow screen", async ({
  page,
  request
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const id = await project(request),
    base = `/api/v1/projects/${id}/work-dags`;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByText("Перенос плана через JSON", { exact: true }).click();
  const file = panel.getByLabel("JSON плана", { exact: true });
  const bad = {
    format: "kosmora.work-plan.v1",
    title: "Cycle",
    nodes: [{ ...nodes[0], depends_on: ["a"] }]
  };
  await file.setInputFiles({
    name: "cycle.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(bad))
  });
  await expect(panel.getByRole("alert")).toContainText("недопустимые зависимости");
  const pkg = { format: "kosmora.work-plan.v1", title: "<script>portable</script>", nodes };
  await file.setInputFiles({
    name: "plan.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pkg))
  });
  const preview = panel.getByRole("form", { name: "Предпросмотр импорта плана", exact: true });
  await expect(preview.getByText(pkg.title, { exact: true })).toBeVisible();
  expect(await preview.locator("script").count()).toBe(0);
  const save = preview.getByRole("button", { name: "Сохранить импортированный план", exact: true });
  await expect(save).toBeDisabled();
  await preview.getByRole("checkbox").check();
  let posts = 0;
  await page.route("**/work-dags/import", async (route) => {
    posts++;
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost acknowledgement" } });
  });
  await save.click();
  await expect(panel.getByRole("heading", { name: pkg.title, exact: true })).toBeVisible();
  const exported = await request.get(
    (await panel
      .getByRole("link", { name: "Скачать JSON плана", exact: true })
      .getAttribute("href"))!
  );
  expect(await exported.json()).toEqual(pkg);
  const items = ((await (await request.get(base)).json()) as { items: WorkDag[] }).items;
  expect(items).toHaveLength(1);
  expect(posts).toBe(1);
  expect(items[0]!.nodes[0]!.attempts).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true
  );
});
