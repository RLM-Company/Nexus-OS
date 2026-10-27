import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type {
  IntelligenceGraphEvidenceAudit,
  IntelligenceGraphWorkspace
} from "@cosmora/contracts";

const seed = async (request: APIRequestContext) => {
  const created = await request.post("/api/v1/projects", {
    data: {
      initial_message: "Проверка источников " + randomUUID(),
      client_message_id: randomUUID()
    }
  });
  expect(created.status()).toBe(201);
  const id = (await created.json()).project.id as string;
  const base = `/api/v1/projects/${id}`;
  await expect
    .poll(async () => (await (await request.get(base)).json()).project.status)
    .toBe("ACTIVE");
  const packet = {
    format: "kosmora.intelligence-graph.v1",
    title: "Аудит источников",
    nodes: [
      {
        key: "s",
        kind: "Source",
        label: "Протокол",
        detail: "Начало\r\n<script>window.auditUnsafe=true</script> $&\r\nКонец"
      },
      { key: "a", kind: "Claim", label: "Без цитат", detail: "Исходная позиция" },
      { key: "b", kind: "Claim", label: "С цитатой", detail: "Проверяемая позиция" }
    ],
    edges: [
      {
        relation: "SUPPORTS",
        from: "a",
        to: "b",
        evidence: {
          source: "s",
          location: "строка 2",
          excerpt: "\r\n<script>window.auditUnsafe=true</script> $&\r\n"
        }
      }
    ]
  };
  const preview = await request.post(base + "/intelligence-graphs/import/preview", {
    data: { package: packet }
  });
  expect(preview.ok()).toBe(true);
  const imported = await request.post(base + "/intelligence-graphs/import", {
    data: { package: packet, expected_sha256: (await preview.json()).sha256 }
  });
  expect(imported.status()).toBe(201);
  const graph = (await imported.json()) as IntelligenceGraphWorkspace;
  return { id, base, graph, graphUrl: `${base}/intelligence-graphs/${graph.graph_id}` };
};
const open = async (page: Page, projectId: string, revision: number) => {
  await page.goto(`/graph-workspace?projectId=${projectId}`);
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page.getByRole("button", { name: `Аудит источников · v${revision}`, exact: true }).click();
  return page.getByRole("region", { name: "Проверка источников графа", exact: true });
};

test("real API audit filters locally, renders literal citations and downloads the checked JSON without writes", async ({
  page,
  request
}) => {
  const f = await seed(request);
  const before = await (await request.get(f.graphUrl)).json();
  let writes = 0,
    reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/intelligence-graphs") && r.method() !== "GET") writes++;
    if (r.url().includes("/evidence-audit")) reads++;
  });
  const panel = await open(page, f.id, 1);
  expect(reads).toBe(0);
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Без цитат", exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: "С цитатой", exact: true })).toHaveCount(0);
  await panel.getByRole("checkbox", { name: "Только без действующих цитат" }).uncheck();
  await expect(panel.getByRole("heading", { name: "С цитатой", exact: true })).toBeVisible();
  await panel.locator("summary").click();
  await expect(panel.locator("blockquote")).toContainText(
    "<script>window.auditUnsafe=true</script> $&"
  );
  expect(await page.evaluate(() => Reflect.get(window, "auditUnsafe"))).toBeUndefined();
  const downloadEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Скачать проверку источников JSON" }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(`graph-evidence-${f.graph.graph_id}-v1.json`);
  const bytes = await readFile((await download.path())!);
  const report = JSON.parse(bytes.toString("utf8")) as IntelligenceGraphEvidenceAudit;
  expect(report.statistics).toMatchObject({
    claims: 2,
    with_current_citations: 1,
    without_citations: 1
  });
  await expect(
    panel.getByText(
      `SHA-256 скачиваемого JSON: ${createHash("sha256").update(bytes).digest("hex")}`,
      { exact: true }
    )
  ).toBeVisible();
  const csvEvent = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Скачать все связи CSV" }).click();
  const csv = await csvEvent;
  expect(csv.suggestedFilename()).toBe(`graph-evidence-${f.graph.graph_id}-v1.csv`);
  const csvBytes = await readFile((await csv.path())!);
  expect(csvBytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(csvBytes.toString("utf8")).toContain("Без цитат");
  expect(csvBytes.toString("utf8")).toContain("С цитатой");
  expect(reads).toBe(1);
  expect(writes).toBe(0);
  expect(await (await request.get(f.graphUrl)).json()).toEqual(before);
  expect((await (await request.get(f.base + "/materials")).json()).version).toBe(0);
});

test("a source edit exposes the pinned historical citation while the original audit stays reproducible", async ({
  page,
  request
}) => {
  const f = await seed(request);
  const original = await (await request.get(f.graphUrl + "/evidence-audit?revision=1")).json();
  const source = f.graph.nodes.find((n) => n.kind === "Source")!;
  const edited = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: 1,
      operation: {
        kind: "revise_node",
        node: { id: source.node_id, version: 1 },
        label: "Новый протокол",
        detail: "Новый текст без исходной цитаты"
      }
    }
  });
  expect(edited.ok()).toBe(true);
  const revision = (await edited.json()).revision as number;
  const panel = await open(page, f.id, revision);
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "С цитатой", exact: true })).toBeVisible();
  await expect(
    panel.getByText("Цитаты только из прежних версий источников", { exact: true })
  ).toBeVisible();
  await panel.locator("summary").click();
  await expect(panel.locator("blockquote")).toContainText("Протокол");
  await expect(panel.locator("blockquote")).toContainText(`${source.node_id}@1`);
  expect(await (await request.get(f.graphUrl + "/evidence-audit?revision=1")).json()).toEqual(
    original
  );
});

test("a mismatched audit hash is refused and recovery requires an explicit read", async ({
  page,
  request
}) => {
  const f = await seed(request);
  let tamper = true,
    reads = 0;
  await page.route("**/evidence-audit?revision=1", async (route) => {
    reads++;
    const response = await route.fetch();
    const result = await response.json();
    await route.fulfill({
      response,
      json: tamper ? { ...result, sha256: "a".repeat(64) } : result
    });
  });
  const panel = await open(page, f.id, 1);
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("не совпал");
  await expect(panel.getByRole("button", { name: "Скачать проверку источников JSON" })).toHaveCount(
    0
  );
  expect(reads).toBe(1);
  tamper = false;
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Без цитат", exact: true })).toBeVisible();
  expect(reads).toBe(2);
});
