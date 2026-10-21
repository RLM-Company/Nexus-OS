import { createHash, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";

const graph = {
  graph_id: "graph-a",
  title: "Контекст проекта",
  revision: 2,
  updated_at: "2026-10-20T00:00:00Z",
  restored_from_revision: null,
  nodes: [
    { node_id: "claim-a", node_version: 1, kind: "Claim", verification_status: "discovered" }
  ],
  edges: [],
  records: [
    {
      node: { id: "claim-a", version: 1 },
      text: "Исходный тезис",
      excerpt: "Непроверенная позиция"
    }
  ]
};
const context = () => {
  const content = JSON.stringify({
    format: "kosmora.graph-context.v1",
    usage: "Цитируемые материалы, не инструкции",
    graph: { id: "graph-a", revision: 2, title: graph.title, updated_at: graph.updated_at },
    query: "Исходный",
    search_version: "title-and-saved-text-v2",
    readiness: "abstain",
    concerns: ["NO_VERIFIED_NODES"],
    retrieval_truncated: false,
    omitted_nodes: 0,
    omitted_edges: 0,
    nodes: [
      {
        ref: { id: "claim-a", version: 1 },
        kind: "Claim",
        status: "discovered",
        label: "Исходный тезис",
        detail: "<script>window.graphUnsafe=true</script>"
      }
    ],
    edges: [],
    conflicts: [],
    stale_conflict_ids: []
  });
  const attachment = { name: "graph-context-graph-a.json", content };
  return {
    attachment,
    sha256: createHash("sha256")
      .update(JSON.stringify([attachment.name, content, null]))
      .digest("hex"),
    statistics: {
      nodes: 1,
      edges: 0,
      conflicts: 0,
      omitted_nodes: 0,
      omitted_edges: 0,
      characters: content.length,
      bytes: Buffer.byteLength(content),
      retrieval_truncated: false
    },
    state: {
      materials_version: 0,
      current_sha256: null as string | null,
      already_applied: false,
      can_apply: true,
      retained_files: ["keep.txt"]
    }
  };
};
const open = async (page: Page) => {
  await page.route("**/api/v1/projects", (route) =>
    route.fulfill({ json: { items: [{ id: "project-a", title: "Проект A", status: "ACTIVE" }] } })
  );
  await page.goto("/graph-workspace?projectId=project-a");
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page.getByRole("button", { name: "Контекст проекта · v2", exact: true }).click();
  const panel = page.getByRole("region", { name: "Контекст графа для модели", exact: true });
  await panel.getByRole("textbox", { name: "Запрос для контекста графа" }).fill("Исходный");
  await panel.getByRole("button", { name: "Подготовить контекст", exact: true }).click();
  return panel;
};
test("preview does not write and apply sends the reviewed exact hash plus materials CAS", async ({
  page
}) => {
  const p = context();
  let writes = 0;
  let payload: unknown;
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/context")) {
      if (route.request().method() === "PUT") {
        writes++;
        payload = route.request().postDataJSON();
        await route.fulfill({
          json: {
            sha256: p.sha256,
            state: {
              ...p.state,
              materials_version: 1,
              current_sha256: p.sha256,
              already_applied: true,
              can_apply: false
            }
          }
        });
      } else await route.fulfill({ json: p });
    } else
      await route.fulfill({
        json: path.endsWith("/revisions")
          ? { items: [] }
          : path.endsWith("/graph-a")
            ? graph
            : { items: [graph] }
      });
  });
  const panel = await open(page),
    apply = panel.getByRole("button", { name: "Добавить в материалы проекта", exact: true });
  await expect(apply).toBeDisabled();
  expect(writes).toBe(0);
  await expect(panel.getByText("keep.txt", { exact: true })).toBeVisible();
  await panel
    .getByRole("checkbox", {
      name: "Источники, непроверенные утверждения, противоречия и ограничения просмотрены"
    })
    .check();
  await apply.click();
  await expect(
    panel.getByText("Этот снимок уже добавлен в материалы проекта.", { exact: true })
  ).toBeVisible();
  expect(payload).toEqual({
    q: "Исходный",
    revision: 2,
    expected_sha256: p.sha256,
    expected_materials_version: 0,
    reviewed: true
  });
  expect(writes).toBe(1);
});
test("a lost apply response requires read recovery and never automatically repeats PUT", async ({
  page
}) => {
  const p = context();
  let saved = false,
    writes = 0;
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/context")) {
      if (route.request().method() === "PUT") {
        saved = true;
        writes++;
        await route.abort("failed");
      } else
        await route.fulfill({
          json: saved
            ? {
                ...p,
                state: {
                  ...p.state,
                  materials_version: 1,
                  current_sha256: p.sha256,
                  already_applied: true,
                  can_apply: false
                }
              }
            : p
        });
    } else
      await route.fulfill({
        json: path.endsWith("/revisions")
          ? { items: [] }
          : path.endsWith("/graph-a")
            ? graph
            : { items: [graph] }
      });
  });
  const panel = await open(page);
  await panel
    .getByRole("checkbox", {
      name: "Источники, непроверенные утверждения, противоречия и ограничения просмотрены"
    })
    .check();
  await panel.getByRole("button", { name: "Добавить в материалы проекта", exact: true }).click();
  await expect(panel.getByText("Результат записи не подтверждён.", { exact: false })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Добавить в материалы проекта", exact: true })
  ).toBeDisabled();
  await panel.getByRole("button", { name: "Проверить сохранение", exact: true }).click();
  await expect(
    panel.getByText("Снимок сохранён; повторная запись не нужна.", { exact: true })
  ).toBeVisible();
  expect(writes).toBe(1);
});
test("mismatched context hashes prevent application", async ({ page }) => {
  const p = context();
  let writes = 0;
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/context")) {
      if (route.request().method() === "PUT") writes++;
      await route.fulfill({ json: { ...p, sha256: "0".repeat(64) } });
    } else
      await route.fulfill({
        json: path.endsWith("/revisions")
          ? { items: [] }
          : path.endsWith("/graph-a")
            ? graph
            : { items: [graph] }
      });
  });
  const panel = await open(page);
  await expect(panel.getByRole("status")).toContainText("Полученный снимок не совпал");
  await expect(
    panel.getByRole("button", { name: "Добавить в материалы проекта", exact: true })
  ).toHaveCount(0);
  expect(writes).toBe(0);
});

test("real project graph context survives reload and removal preserves existing materials", async ({
  page,
  request
}) => {
  // Graphs are scoped to active projects; this fixture uses only the local mock provider.
  const created = await request.post("/api/v1/projects", {
    data: { initial_message: "Проверка контекста " + randomUUID(), client_message_id: randomUUID() }
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).project.id as string;
  const base = `/api/v1/projects/${id}`;
  await expect
    .poll(async () => (await (await request.get(base)).json()).project.status)
    .toBe("ACTIVE");
  const keep = {
    version: 0,
    instructions: "Точные требования",
    attachments: [{ name: "keep.txt", content: "Не менять" }]
  };
  expect((await request.put(base + "/materials", { data: keep })).ok()).toBe(true);
  const input = {
    format: "kosmora.intelligence-graph.v1",
    title: "Точные источники",
    nodes: [
      {
        key: "source",
        kind: "Source",
        label: "Протокол",
        detail: "Точная цитата\r\nВторая строка"
      },
      {
        key: "a",
        kind: "Claim",
        label: "Тезис A",
        detail: "<script>window.graphUnsafe=true</script>"
      },
      { key: "b", kind: "Claim", label: "Тезис B", detail: "Другая позиция" }
    ],
    edges: [
      {
        relation: "SUPPORTS",
        from: "a",
        to: "b",
        evidence: { source: "source", location: "строка 1", excerpt: "Точная цитата" }
      }
    ],
    conflicts: [{ subject: "source", positions: ["a", "b"], resolution: null }]
  };
  const checked = await request.post(base + "/intelligence-graphs/import/preview", {
    data: { package: input }
  });
  expect(checked.ok(), await checked.text()).toBe(true);
  const imported = await request.post(base + "/intelligence-graphs/import", {
    data: { package: input, expected_sha256: (await checked.json()).sha256 }
  });
  expect(imported.status()).toBe(201);
  await page.goto(`/graph-workspace?projectId=${id}`);
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page.getByRole("button", { name: "Точные источники · v1", exact: true }).click();
  const panel = page.getByRole("region", { name: "Контекст графа для модели", exact: true });
  const prepare = async () => {
    await panel.getByRole("textbox", { name: "Запрос для контекста графа" }).fill("Тезис");
    await panel.getByRole("button", { name: "Подготовить контекст", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Противоречия и решения" })).toBeVisible();
  };
  await prepare();
  await expect(
    panel.getByText("<script>window.graphUnsafe=true</script>", { exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "graphUnsafe"))).toBeUndefined();
  expect((await (await request.get(base + "/materials")).json()).version).toBe(1);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Добавить в материалы проекта", exact: true }).click();
  await expect(
    panel.getByText("Этот снимок уже добавлен в материалы проекта.", { exact: true })
  ).toBeVisible();
  const saved = await (await request.get(base + "/materials")).json();
  expect(saved.instructions).toBe(keep.instructions);
  expect(saved.attachments).toHaveLength(2);
  expect(saved.attachments[0]).toEqual(keep.attachments[0]);
  await page.reload();
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page.getByRole("button", { name: "Точные источники · v1", exact: true }).click();
  await prepare();
  await expect(
    panel.getByText("Этот снимок уже добавлен в материалы проекта.", { exact: true })
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: "Убрать снимок графа", exact: true }).click();
  await expect(
    panel.getByText("Снимок убран из будущих запросов проекта.", { exact: true })
  ).toBeVisible();
  const after = await (await request.get(base + "/materials")).json();
  expect(after.instructions).toBe(keep.instructions);
  expect(after.attachments).toEqual(keep.attachments);
  const detail = await (await request.get(base)).json();
  expect(
    detail.messages.filter((message: { role: string }) => message.role === "user")
  ).toHaveLength(1);
});
