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

const prepareRefresh = async (page: Page, request: APIRequestContext, keepQuote = true) => {
  const f = await seed(request);
  const source = f.graph.nodes.find((n) => n.kind === "Source")!;
  const text = f.graph.records.find((r) => r.node.id === source.node_id)!.excerpt;
  const edited = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: 1,
      operation: {
        kind: "revise_node",
        node: { id: source.node_id, version: 1 },
        label: "Новый протокол",
        detail: keepQuote ? "Добавленная строка\n" + text : "Новая версия без прежней цитаты"
      }
    }
  });
  expect(edited.ok()).toBe(true);
  const graph = (await edited.json()) as IntelligenceGraphWorkspace;
  const panel = await open(page, f.id, graph.revision);
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "С цитатой", exact: true })).toBeVisible();
  await panel.locator("summary").click();
  await panel
    .getByRole("button", { name: "Сверить с новой версией источника", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Сверка новой версии источника", exact: true });
  await expect(review).toBeVisible();
  return { ...f, changed: graph, panel, review, source };
};

test("citation refresh requires a new location and review, preserves literal bytes and historical snapshots", async ({
  page,
  request
}) => {
  const f = await prepareRefresh(page, request);
  const before = (await (await request.get(f.graphUrl)).json()) as IntelligenceGraphWorkspace;
  let writes = 0;
  let payload: {
    expected_revision: number;
    operation: { source: { id: string; version: number }; excerpt: string; location: string };
  } | null = null;
  page.on("request", (r) => {
    if (r.url().endsWith("/edits") && r.method() === "POST") {
      writes++;
      payload = r.postDataJSON();
    }
  });
  await expect(f.review.getByLabel("Текст действующей версии источника")).toContainText(
    "Добавленная строка"
  );
  await expect(f.review.locator("blockquote")).toContainText(
    "<script>window.auditUnsafe=true</script> $&"
  );
  await expect(f.review.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "auditUnsafe"))).toBeUndefined();
  const save = f.review.getByRole("button", {
    name: "Сохранить новую ссылку на источник",
    exact: true
  });
  await expect(save).toBeDisabled();
  const location = f.review.getByRole("textbox", { name: "Место в новой версии источника" });
  await expect(location).toHaveValue("");
  await location.fill("Новая строка 3");
  await expect(save).toBeDisabled();
  await f.review
    .getByRole("checkbox", { name: "Сверил цитату, контекст и место в новой версии" })
    .check();
  await location.fill("Новая строка 3, полный фрагмент");
  await expect(save).toBeDisabled();
  await f.review.getByRole("checkbox").check();
  expect(writes).toBe(0);
  expect(await (await request.get(f.graphUrl)).json()).toEqual(before);
  await save.click();
  await expect(f.review).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Ссылка на источник обновлена"
  );
  expect(writes).toBe(1);
  const latestSource = before.nodes.find(
    (n) => n.node_id === f.source.node_id && n.verification_status === "discovered"
  )!;
  expect(payload).toEqual({
    expected_revision: before.revision,
    operation: {
      kind: "cite_edge",
      edge_id: before.edges[0]!.edge_id,
      source: { id: f.source.node_id, version: latestSource.node_version },
      location: "Новая строка 3, полный фрагмент",
      excerpt: f.graph.edges[0]!.evidence_excerpt
    }
  });
  const after = (await (await request.get(f.graphUrl)).json()) as IntelligenceGraphWorkspace;
  const current = after.edges.find((e) => e.verification_status === "discovered")!;
  expect(current.evidence_ref.source_version).toBe(latestSource.node_version);
  expect(current.evidence_excerpt).toBe(f.graph.edges[0]!.evidence_excerpt);
  expect(
    after.edges.some(
      (e) => e.verification_status === "superseded" && e.evidence_ref.source_version === 1
    )
  ).toBe(true);
  const old = (await (await request.get(f.graphUrl + "/evidence-audit?revision=1")).json()) as {
    report: IntelligenceGraphEvidenceAudit;
  };
  expect(
    old.report.claims.find((c) => c.supports.length)!.supports[0]!.citation!.source.version
  ).toBe(1);
  expect((await (await request.get(f.base + "/materials")).json()).version).toBe(0);
});

test("a removed literal quote can be inspected but cannot be transferred", async ({
  page,
  request
}) => {
  const f = await prepareRefresh(page, request, false);
  const before = await (await request.get(f.graphUrl)).json();
  await expect(f.review.getByText("Точная цитата отсутствует", { exact: false })).toBeVisible();
  await expect(
    f.review.getByRole("button", { name: "Сохранить новую ссылку на источник" })
  ).toHaveCount(0);
  expect(await (await request.get(f.graphUrl)).json()).toEqual(before);
});

test("a concurrent edit rejects citation refresh and retains the reviewed draft without retry", async ({
  page,
  request
}) => {
  const f = await prepareRefresh(page, request);
  const location = f.review.getByRole("textbox", { name: "Место в новой версии источника" });
  await location.fill("Мой просмотренный фрагмент");
  await f.review.getByRole("checkbox").check();
  const concurrent = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: f.changed.revision,
      operation: { kind: "rename", title: "Чужая правка названия" }
    }
  });
  expect(concurrent.ok()).toBe(true);
  let writes = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/edits") && r.method() === "POST") writes++;
  });
  const save = f.review.getByRole("button", { name: "Сохранить новую ссылку на источник" });
  await save.click();
  await expect(f.review.getByRole("alert")).toContainText("Загрузите граф заново");
  await expect(save).toBeDisabled();
  await expect(location).toHaveValue("Мой просмотренный фрагмент");
  expect(writes).toBe(1);
  const after = (await (await request.get(f.graphUrl)).json()) as IntelligenceGraphWorkspace;
  expect(after.title).toBe("Чужая правка названия");
  expect(
    after.edges.find((e) => e.verification_status === "discovered")!.evidence_ref.source_version
  ).toBe(1);
});

test("a lost refresh reply never repeats the accepted write and reload recovers actual state", async ({
  page,
  request
}) => {
  const f = await prepareRefresh(page, request);
  await f.review.getByRole("textbox").fill("Строка 3 после сверки");
  await f.review.getByRole("checkbox").check();
  let writes = 0;
  await page.route("**/intelligence-graphs/*/edits", async (route) => {
    writes++;
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("connectionfailed");
  });
  const save = f.review.getByRole("button", { name: "Сохранить новую ссылку на источник" });
  await save.click();
  await expect(f.review.getByRole("alert")).toContainText("Сохранение не подтверждено");
  await expect(save).toBeDisabled();
  expect(writes).toBe(1);
  const after = (await (await request.get(f.graphUrl)).json()) as IntelligenceGraphWorkspace;
  expect(after.revision).toBe(f.changed.revision + 1);
  await f.review.getByRole("button", { name: "Загрузить состояние графа", exact: true }).click();
  await expect(f.review).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Проверка источников графа", exact: true });
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(
    panel.getByText("С цитатами действующих источников: 1.", { exact: false })
  ).toBeVisible();
  expect(writes).toBe(1);
});
