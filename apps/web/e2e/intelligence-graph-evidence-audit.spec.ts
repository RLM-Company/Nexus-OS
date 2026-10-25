import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import type {
  IntelligenceGraphEvidenceAudit,
  IntelligenceGraphWorkspace
} from "@cosmora/contracts";
import { parseCsv } from "../src/app/studio-csv";
import type { SourceUsageExport } from "../src/app/graph-workspace/source-usage-export";
import type { EvidenceComparison } from "../src/app/graph-workspace/evidence-comparison";

const seed = async (request: APIRequestContext, extended = false) => {
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
  if (extended) {
    packet.nodes.push(
      {
        key: "other",
        kind: "Source",
        label: "Протокол",
        detail: "Другой источник с тем же названием"
      },
      { key: "c", kind: "Claim", label: "Второе зависимое утверждение", detail: "Другая позиция" },
      { key: "d", kind: "Claim", label: "Из другого источника", detail: "Отдельная позиция" }
    );
    packet.edges.push(
      {
        relation: "SUPPORTS",
        from: "a",
        to: "c",
        evidence: { source: "s", location: "строка 2", excerpt: packet.edges[0]!.evidence.excerpt }
      },
      {
        relation: "SUPPORTS",
        from: "a",
        to: "d",
        evidence: { source: "other", location: "строка 1", excerpt: "Другой источник" }
      }
    );
  }
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

const prepareRefresh = async (
  page: Page,
  request: APIRequestContext,
  keepQuote: boolean | string = true
) => {
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
        detail:
          typeof keepQuote === "string"
            ? keepQuote
            : keepQuote
              ? "Добавленная строка\n" + text
              : "Новая версия без прежней цитаты"
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

test("a missing quote can be replaced by an explicitly selected exact fragment with original CRLF bytes", async ({
  page,
  request
}) => {
  const excerpt = "🙂 Новое утверждение\r\n<script>window.replacementUnsafe=true</script> $&\r\n";
  const f = await prepareRefresh(page, request, "Вступление\r\n" + excerpt + "Контекст");
  let writes = 0;
  let sent: { operation: { excerpt: string } } | undefined;
  page.on("request", (r) => {
    if (r.url().endsWith("/edits") && r.method() === "POST") {
      writes++;
      sent = r.postDataJSON();
    }
  });
  const before = await (await request.get(f.graphUrl)).json();
  await f.review.getByRole("button", { name: "Выбрать новый фрагмент", exact: true }).click();
  const text = f.review.getByRole("textbox", {
    name: "Выделите новый фрагмент источника",
    exact: true
  });
  await expect(text).toHaveValue(
    ("Вступление\r\n" + excerpt + "Контекст").replaceAll("\r\n", "\n")
  );
  await text.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(element.value.indexOf("🙂"), element.value.indexOf("Контекст"));
    element.dispatchEvent(new Event("select", { bubbles: true }));
  });
  await f.review
    .getByRole("button", { name: "Использовать выделенный фрагмент", exact: true })
    .click();
  await expect(f.review.getByRole("blockquote", { name: "Выбранная новая цитата" })).toContainText(
    "Новое утверждение"
  );
  await expect(f.review.locator("script")).toHaveCount(0);
  const save = f.review.getByRole("button", {
    name: "Сохранить новую ссылку на источник",
    exact: true
  });
  await expect(save).toBeDisabled();
  await f.review
    .getByRole("textbox", { name: "Место в новой версии источника" })
    .fill("Новые строки 2–3");
  await f.review.getByRole("checkbox").check();
  expect(writes).toBe(0);
  expect(await (await request.get(f.graphUrl)).json()).toEqual(before);
  await save.click();
  await expect(f.review).toHaveCount(0);
  expect(writes).toBe(1);
  expect(sent!.operation.excerpt).toBe(excerpt);
  const after = (await (await request.get(f.graphUrl)).json()) as IntelligenceGraphWorkspace;
  expect(after.edges.find((e) => e.verification_status === "discovered")!.evidence_excerpt).toBe(
    excerpt
  );
  expect(after.edges.find((e) => e.verification_status === "superseded")!.evidence_excerpt).toBe(
    f.graph.edges[0]!.evidence_excerpt
  );
  expect((await (await request.get(f.base + "/materials")).json()).version).toBe(0);
  expect(await page.evaluate(() => Reflect.get(window, "replacementUnsafe"))).toBeUndefined();
});

test("changing the source selection clears location and review, and cancelling selection restores the original draft mode", async ({
  page,
  request
}) => {
  const f = await prepareRefresh(page, request);
  await f.review.getByRole("button", { name: "Выбрать новый фрагмент", exact: true }).click();
  const text = f.review.getByRole("textbox", { name: "Выделите новый фрагмент источника" });
  const choose = f.review.getByRole("button", {
    name: "Использовать выделенный фрагмент",
    exact: true
  });
  await choose.click();
  await expect(f.review.getByRole("alert")).toContainText("Выделите непустой");
  await text.evaluate((element: HTMLTextAreaElement) => {
    element.focus();
    element.setSelectionRange(0, 10);
  });
  await choose.click();
  await f.review.getByRole("textbox", { name: "Место в новой версии источника" }).fill("Начало");
  await f.review.getByRole("checkbox").check();
  await text.focus();
  await text.press("Home");
  await text.press("Shift+ArrowRight");
  await expect(
    f.review.getByRole("button", { name: "Сохранить новую ссылку на источник" })
  ).toHaveCount(0);
  await choose.click();
  await expect(
    f.review.getByRole("textbox", { name: "Место в новой версии источника" })
  ).toHaveValue("");
  await expect(f.review.getByRole("checkbox")).not.toBeChecked();
  await f.review.getByRole("button", { name: "Отменить выбор фрагмента", exact: true }).click();
  await expect(text).toHaveCount(0);
  await expect(
    f.review.getByRole("button", { name: "Сохранить новую ссылку на источник" })
  ).toBeDisabled();
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
    expect(
      response.ok(),
      `accepted before lost reply: ${response.status()} ${await response.text()}`
    ).toBe(true);
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

const prepareSourceUsage = async (page: Page, request: APIRequestContext) => {
  const f = await seed(request, true);
  const source = f.graph.nodes.find((n) => n.kind === "Source")!;
  const sourceText = f.graph.records.find((r) => r.node.id === source.node_id)!.excerpt;
  const edited = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: 1,
      operation: {
        kind: "revise_node",
        node: { id: source.node_id, version: source.node_version },
        label: "Обновлённый протокол",
        detail: "Контекст\r\n" + sourceText
      }
    }
  });
  expect(edited.ok()).toBe(true);
  let graph = (await edited.json()) as IntelligenceGraphWorkspace;
  const currentSource = graph.nodes.find(
    (n) => n.node_id === source.node_id && n.verification_status === "discovered"
  )!;
  const target = graph.records.find((r) => r.text === "Второе зависимое утверждение")!.node;
  const edge = graph.edges.find((e) => e.to.id === target.id)!;
  const cited = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: graph.revision,
      operation: {
        kind: "cite_edge",
        edge_id: edge.edge_id,
        source: { id: source.node_id, version: currentSource.node_version },
        location: "Новая строка 3",
        excerpt: edge.evidence_excerpt
      }
    }
  });
  expect(cited.ok()).toBe(true);
  graph = (await cited.json()) as IntelligenceGraphWorkspace;
  const audit = await open(page, f.id, graph.revision);
  await audit.getByRole("button", { name: "Проверить источники", exact: true }).click();
  const usage = audit.getByRole("region", { name: "Где используется источник", exact: true });
  await expect(usage).toBeVisible();
  return { ...f, changed: graph, source, currentSource, audit, usage };
};

test("source usage groups exact identities, filters versions locally and opens review for the exact historical support", async ({
  page,
  request
}) => {
  const f = await prepareSourceUsage(page, request);
  const before = await (await request.get(f.graphUrl)).json();
  let network = 0;
  page.on("request", (r) => {
    if (r.url().includes("/intelligence-graphs")) network++;
  });
  const source = f.usage.getByRole("combobox", { name: "Источник для просмотра использования" });
  await source.selectOption(f.source.node_id);
  await expect(f.usage.getByText("Утверждений: 2. Цитат: 2.", { exact: false })).toBeVisible();
  await expect(f.usage.getByRole("heading", { name: "С цитатой", exact: true })).toBeVisible();
  await expect(
    f.usage.getByRole("heading", { name: "Второе зависимое утверждение", exact: true })
  ).toBeVisible();
  const version = f.usage.getByRole("combobox", { name: "Цитируемая версия источника" });
  await version.selectOption("1");
  await expect(
    f.usage.getByRole("heading", { name: "Второе зависимое утверждение", exact: true })
  ).toHaveCount(0);
  await expect(f.usage.getByText("Из прежних версий: 1.", { exact: false })).toBeVisible();
  await f.usage.locator("summary").click();
  await expect(f.usage.locator("blockquote")).toContainText(
    "<script>window.auditUnsafe=true</script> $&"
  );
  expect(await page.evaluate(() => Reflect.get(window, "auditUnsafe"))).toBeUndefined();
  await version.selectOption(String(f.currentSource.node_version));
  await expect(f.usage.getByRole("heading", { name: "С цитатой", exact: true })).toHaveCount(0);
  await expect(
    f.usage.getByRole("heading", { name: "Второе зависимое утверждение", exact: true })
  ).toBeVisible();
  const foreign = f.graph.nodes.find((n) => n.kind === "Source" && n.node_id !== f.source.node_id)!;
  await source.selectOption(foreign.node_id);
  await expect(version).toHaveValue("all");
  await expect(
    f.usage.getByRole("heading", { name: "Из другого источника", exact: true })
  ).toBeVisible();
  await expect(f.usage.getByRole("heading", { name: "С цитатой", exact: true })).toHaveCount(0);
  await source.selectOption(f.source.node_id);
  await version.selectOption("1");
  await f.usage.locator("summary").click();
  await f.usage
    .getByRole("button", { name: "Сверить с новой версией источника", exact: true })
    .click();
  const review = page.getByRole("region", { name: "Сверка новой версии источника", exact: true });
  const oldSupport = f.changed.edges.find(
    (e) =>
      e.verification_status === "discovered" &&
      e.evidence_ref.source_id === f.source.node_id &&
      e.evidence_ref.source_version === 1
  )!;
  await expect(review).toContainText(`Связь ${oldSupport.edge_id}@${oldSupport.edge_version}`);
  await expect(
    review.getByRole("heading", { name: "Поддерживаемый узел", exact: true })
  ).toBeVisible();
  expect(network).toBe(0);
  expect(await (await request.get(f.graphUrl)).json()).toEqual(before);
});

test("an audit without quoted supports offers no invented source usage", async ({
  page,
  request
}) => {
  const f = await seed(request);
  const cleared = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: 1,
      operation: { kind: "clear_edge_evidence", edge_id: f.graph.edges[0]!.edge_id }
    }
  });
  expect(cleared.ok()).toBe(true);
  const graph = (await cleared.json()) as IntelligenceGraphWorkspace;
  const audit = await open(page, f.id, graph.revision);
  await audit.getByRole("button", { name: "Проверить источники", exact: true }).click();
  const usage = audit.getByRole("region", { name: "Где используется источник", exact: true });
  await expect(usage).toContainText("В этой проверке нет источников с цитатами.");
  await expect(usage.getByRole("combobox")).toHaveCount(0);
});

test("source usage downloads only the selected scope with exact provenance and resets after another revision is opened", async ({
  page,
  request
}) => {
  const f = await prepareSourceUsage(page, request);
  const audit = (await (
    await request.get(f.graphUrl + `/evidence-audit?revision=${f.changed.revision}`)
  ).json()) as { report: IntelligenceGraphEvidenceAudit; sha256: string };
  let browserRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/intelligence-graphs")) browserRequests++;
  });
  await f.usage
    .getByRole("combobox", { name: "Источник для просмотра использования" })
    .selectOption(f.source.node_id);
  const versions = f.usage.getByRole("combobox", { name: "Цитируемая версия источника" });
  await versions.selectOption("1");
  const jsonEvent = page.waitForEvent("download");
  await f.usage
    .getByRole("button", { name: "Скачать использование источника JSON", exact: true })
    .click();
  const json = await jsonEvent;
  expect(json.suggestedFilename()).toBe(
    `graph-source-${f.graph.graph_id}-${f.source.node_id}-r${f.changed.revision}-v1.json`
  );
  const bytes = await readFile((await json.path())!);
  const value = JSON.parse(bytes.toString("utf8")) as SourceUsageExport;
  expect(value.format).toBe("kosmora.graph-source-usage.v1");
  expect(value.scope).toEqual({ source_id: f.source.node_id, source_version: 1 });
  expect(value.graph).toEqual(audit.report.graph);
  expect(value.audit.sha256).toBe(
    createHash("sha256").update(JSON.stringify(audit.report)).digest("hex")
  );
  expect(value.source.counts).toEqual({
    claims: 1,
    citations: 1,
    current_citations: 0,
    historical_citations: 1
  });
  expect(value.source.claims[0]!.supports[0]!.citation.quote).toBe(
    f.graph.edges[0]!.evidence_excerpt
  );
  const foreign = f.graph.nodes.find((n) => n.kind === "Source" && n.node_id !== f.source.node_id)!;
  expect(bytes.toString("utf8")).not.toContain(foreign.node_id);
  await versions.selectOption("all");
  const csvEvent = page.waitForEvent("download");
  await f.usage
    .getByRole("button", { name: "Скачать использование источника CSV", exact: true })
    .click();
  const csv = await csvEvent;
  const csvBytes = await readFile((await csv.path())!);
  expect(csvBytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  const table = parseCsv(csvBytes.toString("utf8"));
  expect(table.rows).toHaveLength(2);
  const col = (name: string) => table.headers.indexOf(name);
  expect(table.rows.every((row) => row[col("Источник ID")] === f.source.node_id)).toBe(true);
  expect(table.rows.every((row) => row[col("SHA-256 полной проверки")] === audit.sha256)).toBe(
    true
  );
  expect(new Set(table.rows.map((row) => row[col("Версия источника")]))).toEqual(
    new Set(["1", String(f.currentSource.node_version)])
  );
  expect(browserRequests).toBe(0);
  expect((await (await request.get(f.graphUrl)).json()).revision).toBe(f.changed.revision);
  const renamed = await request.post(f.graphUrl + "/edits", {
    data: {
      expected_revision: f.changed.revision,
      operation: { kind: "rename", title: "Новая ревизия использования" }
    }
  });
  expect(renamed.ok()).toBe(true);
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Новая ревизия использования · v${f.changed.revision + 1}`,
      exact: true
    })
    .click();
  await expect(
    page.getByRole("region", { name: "Где используется источник", exact: true })
  ).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Проверка источников графа", exact: true });
  await panel.getByRole("button", { name: "Проверить источники", exact: true }).click();
  await expect(
    panel.getByRole("combobox", { name: "Источник для просмотра использования" })
  ).toHaveValue("");
  await expect(
    panel.getByRole("button", { name: "Скачать использование источника JSON", exact: true })
  ).toHaveCount(0);
});

test("checked audit comparison reads one pinned revision, ignores local source filters and exports exact before/after provenance", async ({
  page,
  request
}) => {
  const f = await prepareSourceUsage(page, request);
  const beforeGraph = await (await request.get(f.graphUrl)).json();
  const previous = (await (
    await request.get(f.graphUrl + "/evidence-audit?revision=1")
  ).json()) as { report: IntelligenceGraphEvidenceAudit; sha256: string };
  const current = (await (
    await request.get(f.graphUrl + `/evidence-audit?revision=${f.changed.revision}`)
  ).json()) as { report: IntelligenceGraphEvidenceAudit; sha256: string };
  let writes = 0;
  const reads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/intelligence-graphs") && r.method() !== "GET") writes++;
    if (r.url().includes("/evidence-audit")) reads.push(r.url());
  });
  const foreign = f.graph.nodes.find((n) => n.kind === "Source" && n.node_id !== f.source.node_id)!;
  await f.usage
    .getByRole("combobox", { name: "Источник для просмотра использования" })
    .selectOption(foreign.node_id);
  const panel = f.audit.getByRole("region", { name: "Сравнение проверок источников", exact: true });
  const baseline = panel.getByRole("spinbutton", {
    name: "Прежняя ревизия для сравнения источников"
  });
  await baseline.fill(String(f.changed.revision));
  const compare = panel.getByRole("button", { name: "Сравнить проверки источников", exact: true });
  await expect(compare).toBeDisabled();
  await baseline.fill("1");
  await compare.click();
  await expect(panel.getByText("Изменилось: 2. Без изменений: 2.", { exact: false })).toBeVisible();
  expect(reads).toHaveLength(1);
  expect(reads[0]).toContain("revision=1");
  const target = f.changed.records.find((r) => r.text === "С цитатой")!.node;
  const left = panel.getByRole("region", { name: `Было: ${target.id}`, exact: true });
  const right = panel.getByRole("region", { name: `Стало: ${target.id}`, exact: true });
  await left.locator("summary").click();
  await right.locator("summary").click();
  await expect(left).toContainText("Есть цитата действующего источника");
  await expect(right).toContainText("Только прежние версии источников");
  await expect(left.locator("blockquote")).toContainText(
    "<script>window.auditUnsafe=true</script> $&"
  );
  await expect(panel.locator("script")).toHaveCount(0);
  const downloadEvent = page.waitForEvent("download");
  await panel
    .getByRole("button", { name: "Скачать сравнение источников JSON", exact: true })
    .click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(
    `graph-evidence-comparison-${f.graph.graph_id}-r1-r${f.changed.revision}.json`
  );
  const value = JSON.parse(
    (await readFile((await download.path())!)).toString("utf8")
  ) as EvidenceComparison;
  expect(value.format).toBe("kosmora.graph-evidence-comparison.v1");
  expect(value.counts).toEqual({ added: 0, removed: 0, changed: 2, unchanged: 2 });
  expect(value.before).toEqual({ graph: previous.report.graph, audit_sha256: previous.sha256 });
  expect(value.after).toEqual({ graph: current.report.graph, audit_sha256: current.sha256 });
  const change = value.changes.find((c) => c.id === target.id)!;
  expect(change.before!.supports[0]!.citation!.quote).toBe(f.graph.edges[0]!.evidence_excerpt);
  expect(change.after!.supports[0]!.citation!.historical).toBe(true);
  expect(writes).toBe(0);
  expect(await (await request.get(f.graphUrl)).json()).toEqual(beforeGraph);
  expect(await (await request.get(f.graphUrl + "/evidence-audit?revision=1")).json()).toEqual(
    previous
  );
});

test("comparison refuses an unverified historical response and recovers only with a new explicit read", async ({
  page,
  request
}) => {
  const f = await prepareSourceUsage(page, request);
  let tamper = true,
    reads = 0;
  await page.route("**/evidence-audit?revision=1", async (route) => {
    reads++;
    const response = await route.fetch();
    const result = await response.json();
    await route.fulfill({
      response,
      json: tamper ? { ...result, sha256: "0".repeat(64) } : result
    });
  });
  const panel = f.audit.getByRole("region", { name: "Сравнение проверок источников", exact: true });
  await panel.getByRole("spinbutton").fill("1");
  const compare = panel.getByRole("button", { name: "Сравнить проверки источников", exact: true });
  await compare.click();
  await expect(panel.getByRole("alert")).toContainText("не совпал");
  await expect(
    panel.getByRole("button", { name: "Скачать сравнение источников JSON" })
  ).toHaveCount(0);
  expect(reads).toBe(1);
  tamper = false;
  await compare.click();
  await expect(
    panel.getByRole("button", { name: "Скачать сравнение источников JSON" })
  ).toBeVisible();
  expect(reads).toBe(2);
  await panel.getByRole("spinbutton").fill("2");
  await expect(
    panel.getByRole("button", { name: "Скачать сравнение источников JSON" })
  ).toHaveCount(0);
  expect(reads).toBe(2);
});

test("an in-flight historical comparison cannot repopulate a reopened graph", async ({
  page,
  request
}) => {
  const f = await prepareSourceUsage(page, request);
  let release!: () => void, started!: () => void, finished!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const readStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const readFinished = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/evidence-audit?revision=1", async (route) => {
    try {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response });
    } finally {
      finished();
    }
  });
  const panel = f.audit.getByRole("region", { name: "Сравнение проверок источников", exact: true });
  await panel.getByRole("spinbutton").fill("1");
  await panel.getByRole("button", { name: "Сравнить проверки источников", exact: true }).click();
  await readStarted;
  await page.getByRole("button", { name: "Открыть графы", exact: true }).click();
  await page
    .getByRole("button", { name: `Аудит источников · v${f.changed.revision}`, exact: true })
    .click();
  release();
  await readFinished;
  await expect(
    page.getByRole("region", { name: "Сравнение проверок источников", exact: true })
  ).toHaveCount(0);
  const audit = page.getByRole("region", { name: "Проверка источников графа", exact: true });
  await audit.getByRole("button", { name: "Проверить источники", exact: true }).click();
  const reopened = audit.getByRole("region", {
    name: "Сравнение проверок источников",
    exact: true
  });
  await expect(reopened).toBeVisible();
  await expect(
    reopened.getByRole("button", { name: "Скачать сравнение источников JSON" })
  ).toHaveCount(0);
  await expect(reopened.getByRole("spinbutton")).toHaveValue(String(f.changed.revision - 1));
});
