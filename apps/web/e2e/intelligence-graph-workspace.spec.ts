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
  await page.getByLabel("Импорт графа JSON").setInputFiles({
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

test("map navigation distinguishes directed paths from reverse traversal", async ({ page }) => {
  const initial = {
    ...graph(),
    nodes: ["a", "b", "c"].map((id) => ({
      node_id: id,
      node_version: 1,
      kind: "Claim",
      verification_status: "discovered"
    })),
    records: ["a", "b", "c"].map((id) => ({
      node: { id, version: 1 },
      text: "Узел " + id,
      excerpt: "Текст " + id
    })),
    edges: [
      {
        edge_id: "ab",
        edge_version: 1,
        type: "REFERENCES",
        from: { id: "a", version: 1 },
        to: { id: "b", version: 1 },
        verification_status: "discovered"
      },
      {
        edge_id: "bc",
        edge_version: 1,
        type: "SUPPORTS",
        from: { id: "b", version: 1 },
        to: { id: "c", version: 1 },
        verification_status: "discovered"
      }
    ]
  };
  await page.route("**/api/v1/projects/project-a/intelligence-graphs**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/revisions")
        ? { items: [] }
        : path.endsWith("/graph-a")
          ? initial
          : { items: [initial] }
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Выбрать узел: Узел c", exact: true }).click();
  const aside = page.getByRole("complementary", { name: "Выбранный узел" });
  await expect(aside).toContainText("Текст c");
  await page.getByLabel("Конечный узел пути").selectOption("a");
  await expect(aside).toContainText("Путь в выбранном направлении и пределах глубины не найден.");
  await page.getByLabel("Направление поиска пути").selectOption("either");
  await expect(aside.getByText("пройдено против стрелки", { exact: false })).toHaveCount(2);
  await page.getByRole("button", { name: "Увеличить граф", exact: true }).click();
  await expect(page.getByText("125%", { exact: true })).toBeVisible();
});
