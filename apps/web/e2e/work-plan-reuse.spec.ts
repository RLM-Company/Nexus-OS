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

test("renames literally once after a lost acknowledgement and preserves task IDs", async ({
  page,
  request
}) => {
  const id = await project(request),
    base = `/api/v1/projects/${id}/work-dags`;
  const created = await request.post(base, {
    data: { client_request_id: randomUUID(), title: "Original title", nodes }
  });
  const source = (await created.json()) as WorkDag;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByRole("button", { name: "Переименовать план", exact: true }).click();
  const title = "<script>window.renamedUnsafe=true</script>";
  await panel.getByLabel("Новое название плана", { exact: true }).fill(title);
  let writes = 0;
  await page.route("**/work-dags/*/title", async (route) => {
    writes++;
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost acknowledgement" } });
  });
  await panel.getByRole("button", { name: "Сохранить название", exact: true }).click();
  await expect(panel.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(panel.getByRole("form", { name: "Переименование плана", exact: true })).toHaveCount(
    0
  );
  expect(writes).toBe(1);
  expect(await page.evaluate(() => Object.hasOwn(window, "renamedUnsafe"))).toBe(false);
  const saved = (await (await request.get(`${base}/${source.id}`)).json()) as WorkDag;
  expect(saved.nodes.map((n) => n.id)).toEqual(nodes.map((n) => n.id));
  expect(saved.nodes.every((n) => !n.attempts.length)).toBe(true);
});

test("archives once after lost acknowledgement, searches both collections and restores without execution", async ({
  page,
  request
}) => {
  const id = await project(request),
    base = `/api/v1/projects/${id}/work-dags`;
  const created = await request.post(base, {
    data: { client_request_id: randomUUID(), title: "История брифа", nodes }
  });
  const source = (await created.json()) as WorkDag;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByLabel("Поиск планов", { exact: true }).fill("ИСПОЛЬЗОВАТЬ БРИФ");
  await expect(panel.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
  let writes = 0;
  await page.route("**/work-dags/*/archive", async (route) => {
    writes++;
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost acknowledgement" } });
  });
  await panel.getByRole("button", { name: "В архив", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Восстановить план", exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await expect(panel.getByLabel("Раздел планов", { exact: true })).toHaveValue("archived");
  await expect(panel.getByRole("button", { name: "Запустить шаг", exact: true })).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Редактировать не запущенные шаги", exact: true })
  ).toBeDisabled();
  await expect(panel.getByRole("link", { name: "Скачать JSON плана", exact: true })).toBeVisible();
  await page.goto(`/?project=${id}&view=plan&plan=${source.id}`);
  await expect(panel.getByLabel("Раздел планов", { exact: true })).toHaveValue("archived");
  await expect(panel.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
  await panel.getByLabel("Раздел планов", { exact: true }).selectOption("active");
  await expect(
    panel.getByText("В этом разделе подходящих планов нет.", { exact: true })
  ).toBeVisible();
  await panel.getByLabel("Раздел планов", { exact: true }).selectOption("archived");
  await panel.getByLabel("Поиск планов", { exact: true }).fill("нет совпадений");
  await expect(panel.getByRole("heading", { name: source.title, exact: true })).toHaveCount(0);
  await panel.getByLabel("Поиск планов", { exact: true }).fill("");
  await panel.getByRole("button", { name: "Восстановить план", exact: true }).click();
  await expect(panel.getByLabel("Раздел планов", { exact: true })).toHaveValue("active");
  await expect(panel.getByRole("button", { name: "Запустить шаг", exact: true })).toBeVisible();
  expect(writes).toBe(2);
  const restored = (await (await request.get(`${base}/${source.id}`)).json()) as WorkDag;
  expect(restored.archived_at).toBeUndefined();
  expect(restored.nodes.every((n) => !n.attempts.length)).toBe(true);
  expect(restored.execution).toBeUndefined();
});

test("a stale archive request cannot hide a plan edited in another tab", async ({
  page,
  request
}) => {
  const id = await project(request),
    base = `/api/v1/projects/${id}/work-dags`;
  const created = await request.post(base, {
    data: { client_request_id: randomUUID(), title: "Concurrent plan", nodes }
  });
  const source = (await created.json()) as WorkDag;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await page.route("**/work-dags/*/archive", async (route) => {
    const current = (await (await request.get(`${base}/${source.id}`)).json()) as WorkDag;
    const changed = await request.put(`${base}/${source.id}`, {
      data: {
        version: current.version,
        nodes: [{ ...nodes[0], goal: "Changed in another tab" }, nodes[1]]
      }
    });
    expect(changed.ok()).toBe(true);
    await route.continue();
  });
  await panel.getByRole("button", { name: "В архив", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("План изменился");
  const latest = (await (await request.get(`${base}/${source.id}`)).json()) as WorkDag;
  expect(latest.archived_at).toBeUndefined();
  expect(latest.nodes[0]?.goal).toBe("Changed in another tab");
});

test("copies to another project once after lost acknowledgement and opens that exact copy", async ({
  page,
  request
}) => {
  const id = await project(request),
    target = await project(request),
    base = `/api/v1/projects/${id}/work-dags`;
  const skillResponse = await request.post("/api/v1/owner-skills", {
    data: {
      name: "Target " + randomUUID().slice(0, 8),
      summary: "Target instructions",
      instructions: "TARGET_PROJECT_INSTRUCTIONS"
    }
  });
  expect(skillResponse.status()).toBe(201);
  const skill = (await skillResponse.json()) as { id: string };
  const selection = await request.put(`/api/v1/projects/${target}/work-skills`, {
    data: { expected_version: 0, items: [{ skill_id: skill.id, version: 1 }] }
  });
  expect(selection.ok()).toBe(true);
  const created = await request.post(base, {
    data: { client_request_id: randomUUID(), title: "Оригинал", nodes }
  });
  const source = (await created.json()) as WorkDag;
  await page.goto(`/?project=${id}&view=plan`);
  const panel = page.getByRole("region", { name: "План с зависимостями", exact: true });
  await panel.getByRole("button", { name: "Создать копию плана", exact: true }).click();
  await panel.getByLabel("Проект для копии", { exact: true }).selectOption(target);
  await panel.getByLabel("Название копии", { exact: true }).fill("Копия в другом проекте");
  await panel.getByLabel("Инструкции для копии", { exact: true }).selectOption("project");
  let posts = 0;
  await page.route("**/work-dags/*/clone", async (route) => {
    posts++;
    await route.fetch();
    await route.fulfill({ status: 504, json: { error: "Lost acknowledgement" } });
  });
  await panel.getByRole("button", { name: "Сохранить копию", exact: true }).click();
  const link = panel.getByRole("link", { name: "Открыть сохранённую копию", exact: true });
  await expect(link).toBeVisible();
  expect(posts).toBe(1);
  await expect(panel.getByRole("heading", { name: source.title, exact: true })).toBeVisible();
  const copies = (
    (await (await request.get(`/api/v1/projects/${target}/work-dags`)).json()) as {
      items: WorkDag[];
    }
  ).items;
  expect(copies).toHaveLength(1);
  expect(copies[0]?.nodes.every((n) => !n.attempts.length)).toBe(true);
  // A newer plan must not steal selection when following the saved-copy link.
  await request.post(`/api/v1/projects/${target}/work-dags`, {
    data: { client_request_id: randomUUID(), title: "Более новый план", nodes }
  });
  await link.click();
  await expect(
    page.getByRole("heading", { name: "Копия в другом проекте", exact: true })
  ).toBeVisible();
  const snapshot = page.getByLabel("Skills этого плана", { exact: true });
  await snapshot.locator("summary").click();
  await expect(snapshot.locator("pre")).toContainText("TARGET_PROJECT_INSTRUCTIONS");
});

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
