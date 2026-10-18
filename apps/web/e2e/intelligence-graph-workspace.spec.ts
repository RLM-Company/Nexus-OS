import { expect, test, type Page } from "@playwright/test";

const graph = () => ({
  graph_id: "graph-a",
  title: "Проект знаний",
  revision: 2,
  updated_at: "2026-10-18T00:00:00Z",
  restored_from_revision: null,
  nodes: [
    { node_id: "claim-a", node_version: 1, kind: "Claim", verification_status: "discovered" }
  ],
  edges: [],
  records: [
    { node: { id: "claim-a", version: 1 }, text: "Исходный тезис", excerpt: "Исходная цитата" }
  ]
});
const open = async (page: Page) => {
  await page.goto("/graph-workspace?projectId=project-a");
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page.getByRole("button", { name: "Проект знаний · v2", exact: true }).click();
};

test("a rejected node edit retains its unsaved text and cannot silently overwrite a newer graph", async ({
  page
}) => {
  const initial = graph();
  let writes = 0;
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/edits")) {
      writes++;
      await route.fulfill({ status: 409, json: { error: "REVISION_CONFLICT" } });
    } else
      await route.fulfill({
        json: url.pathname.endsWith("/revisions")
          ? { items: [] }
          : url.pathname.endsWith("/graph-a")
            ? initial
            : { items: [initial] }
      });
  });
  await open(page);
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Название выбранного узла" })
    .fill("Мой несохранённый тезис");
  await page.getByRole("button", { name: "Сохранить новую версию узла", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Версия графа изменилась");
  await expect(page.getByRole("textbox", { name: "Название выбранного узла" })).toHaveValue(
    "Мой несохранённый тезис"
  );
  expect(writes).toBe(1);
});

test("restore requires reviewed changes and submits the previewed base revision", async ({
  page
}) => {
  const initial = graph();
  let expectedRevision: number | null = null;
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/restore")) {
      expectedRevision = (route.request().postDataJSON() as { expected_revision: number })
        .expected_revision;
      await route.fulfill({ status: 409, json: { error: "REVISION_CONFLICT" } });
    } else
      await route.fulfill({
        json: path.endsWith("/revisions/1")
          ? { ...initial, revision: 1, nodes: [], records: [] }
          : path.endsWith("/revisions")
            ? { items: [{ revision: 1, summary: "Created", restored_from_revision: null }] }
            : path.endsWith("/graph-a")
              ? initial
              : { items: [initial] }
      });
  });
  await open(page);
  await page.getByRole("button", { name: "Сравнить перед восстановлением" }).click();
  const confirm = page.getByRole("button", { name: "Подтвердить восстановление" });
  await expect(confirm).toBeDisabled();
  await expect(page.getByText("После: Отсутствует", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Изменения просмотрены" }).check();
  await confirm.click();
  await expect(page.getByRole("alert")).toContainText("Версия графа изменилась");
  expect(expectedRevision).toBe(2);
});

test("selecting JSON only previews; import requires review and a matching project", async ({
  page
}) => {
  const initial = graph();
  let imports = 0;
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/import")) {
      imports++;
      await route.fulfill({ status: 201, json: initial });
    } else
      await route.fulfill({
        json: path.endsWith("/revisions")
          ? { items: [] }
          : path.endsWith("/graph-a")
            ? initial
            : { items: [initial] }
      });
  });
  await page.goto("/graph-workspace?projectId=project-a");
  const portable = {
    format: "kosmora.intelligence-graph.v1",
    title: "Импорт",
    nodes: [],
    edges: []
  };
  await page
    .getByLabel("Импорт графа JSON")
    .setInputFiles({
      name: "graph.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(portable))
    });
  const create = page.getByRole("button", { name: "Создать отдельный граф" });
  await expect(create).toBeDisabled();
  expect(imports).toBe(0);
  await page.getByRole("checkbox", { name: "Текст и связи просмотрены" }).check();
  await expect(create).toBeEnabled();
  await create.click();
  await expect(
    page.getByRole("heading", { level: 2 }).filter({ hasText: "Проект знаний" })
  ).toBeVisible();
  expect(imports).toBe(1);
});
