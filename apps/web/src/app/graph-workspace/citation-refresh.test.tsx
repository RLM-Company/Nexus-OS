import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { GraphForComparison } from "./revision-diff";
import { citationRefreshOperation, prepareCitationRefresh } from "./citation-refresh";
import { CitationRefreshReview } from "./citation-refresh-review";

const quote = "\r\n<script>window.refreshUnsafe=true</script> $&\r\n";
const fixture = (): GraphForComparison => ({
  title: "Сверка",
  nodes: [
    { node_id: "source", node_version: 1, kind: "Source", verification_status: "superseded" },
    { node_id: "source", node_version: 3, kind: "Source", verification_status: "discovered" },
    ...["a", "b"].map((id) => ({
      node_id: id,
      node_version: 1,
      kind: "Claim",
      verification_status: "discovered"
    }))
  ],
  records: [
    {
      node: { id: "source", version: 1 },
      text: "Прежний источник",
      excerpt: "До" + quote + "После"
    },
    {
      node: { id: "source", version: 3 },
      text: "Новый источник",
      excerpt: "Добавленная строка\nДо" + quote + "После"
    },
    ...["a", "b"].map((id) => ({ node: { id, version: 1 }, text: id, excerpt: id }))
  ],
  edges: [
    {
      edge_id: "edge",
      edge_version: 2,
      type: "SUPPORTS",
      from: { id: "a", version: 1 },
      to: { id: "b", version: 1 },
      verification_status: "discovered",
      evidence_ref: { source_id: "source", source_version: 1, location: "Прежние строки" },
      evidence_excerpt: quote
    }
  ]
});
const edge = { id: "edge", version: 2 };

describe("reviewed citation source refresh", () => {
  it("pins exact versions and bytes without writes or automatic location reuse", () => {
    const graph = fixture(),
      before = structuredClone(graph);
    const preview = prepareCitationRefresh(graph, edge);
    expect(preview.state).toBe("ready");
    expect(preview.previous.ref).toEqual({ id: "source", version: 1 });
    expect(preview.latest!.ref).toEqual({ id: "source", version: 3 });
    expect(preview.quote).toBe(quote);
    expect(citationRefreshOperation(preview, "  новые строки 3–5  ", true)).toEqual({
      kind: "cite_edge",
      edge_id: "edge",
      source: { id: "source", version: 3 },
      location: "новые строки 3–5",
      excerpt: quote
    });
    expect(graph).toEqual(before);
  });
  it.each(["", "  ", "a".repeat(257), "line\n2", "line\u0000"])(
    "rejects an invalid new location (%s)",
    (location) => {
      expect(() =>
        citationRefreshOperation(prepareCitationRefresh(fixture(), edge), location, true)
      ).toThrow("Укажите место");
    }
  );
  it("requires explicit review and refuses a changed quote even when whitespace looks similar", () => {
    const graph = fixture();
    expect(() =>
      citationRefreshOperation(prepareCitationRefresh(graph, edge), "строки 2–4", false)
    ).toThrow();
    graph.records[1]!.excerpt = graph.records[1]!.excerpt.replaceAll("\r\n", "\n");
    const preview = prepareCitationRefresh(graph, edge);
    expect(preview.state).toBe("quote_missing");
    expect(() => citationRefreshOperation(preview, "строки 2–4", true)).toThrow("нельзя");
  });
  it("does not substitute a different source with the same title or a deleted version", () => {
    const graph = fixture();
    graph.nodes[1]!.verification_status = "deleted";
    graph.nodes.push({
      node_id: "foreign",
      node_version: 1,
      kind: "Source",
      verification_status: "discovered"
    });
    graph.records.push({
      node: { id: "foreign", version: 1 },
      text: "Новый источник",
      excerpt: quote
    });
    const preview = prepareCitationRefresh(graph, edge);
    expect(preview.state).toBe("source_unavailable");
    expect(preview.latest).toBeNull();
    expect(() => citationRefreshOperation(preview, "строка 1", true)).toThrow();
  });
  it("does not replace an already current citation", () => {
    const graph = fixture();
    graph.edges[0]!.evidence_ref!.source_version = 3;
    expect(prepareCitationRefresh(graph, edge).state).toBe("already_current");
    expect(() =>
      citationRefreshOperation(prepareCitationRefresh(graph, edge), "строка 1", true)
    ).toThrow();
  });
  it.each([
    "inactive_edge",
    "wrong_edge_version",
    "missing_source",
    "missing_record",
    "duplicate_record",
    "duplicate_current_source",
    "wrong_kind",
    "missing_target_record",
    "invalid_original_quote"
  ])("fails closed on %s", (change) => {
    const graph = fixture();
    if (change === "inactive_edge") graph.edges[0]!.verification_status = "superseded";
    if (change === "wrong_edge_version") graph.edges[0]!.edge_version = 9;
    if (change === "missing_source") graph.nodes.shift();
    if (change === "missing_record") graph.records.shift();
    if (change === "duplicate_record") graph.records.push(structuredClone(graph.records[0]!));
    if (change === "duplicate_current_source")
      graph.nodes.push({ ...graph.nodes[1]!, node_version: 4 });
    if (change === "wrong_kind") graph.nodes[1]!.kind = "Claim";
    if (change === "missing_target_record")
      graph.records = graph.records.filter((r) => r.node.id !== "b");
    if (change === "invalid_original_quote") graph.records[0]!.excerpt = "Другая цитата";
    expect(() => prepareCitationRefresh(graph, edge)).toThrow();
  });
  it("renders both source versions and HTML literally with saving disabled before review", () => {
    const html = renderToStaticMarkup(
      <CitationRefreshReview
        graph={fixture()}
        edge={edge}
        disabled={false}
        onApply={() => Promise.reject(new Error("must not write while rendering"))}
        onClose={() => undefined}
      />
    );
    expect(html).toContain("Прежний источник");
    expect(html).toContain("Новый источник");
    expect(html).toContain("source@3");
    expect(html).toContain("&lt;script&gt;window.refreshUnsafe=true&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain('value=""');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Сохранить новую ссылку/);
  });
  it("does not offer a save form when the literal quote was removed", () => {
    const graph = fixture();
    graph.records[1]!.excerpt = "Новая версия без цитаты";
    const html = renderToStaticMarkup(
      <CitationRefreshReview
        graph={graph}
        edge={edge}
        disabled={false}
        onApply={() => Promise.resolve()}
        onClose={() => undefined}
      />
    );
    expect(html).toContain("Точная цитата отсутствует");
    expect(html).not.toContain("Сохранить новую ссылку");
    expect(html).toContain("Выбрать новый фрагмент");
  });
  it("accepts an explicitly selected replacement only from the exact latest source", () => {
    const graph = fixture();
    graph.records[1]!.excerpt = "Новый фрагмент\r\n🙂 $&\r\nв контексте";
    const preview = prepareCitationRefresh(graph, edge);
    const before = structuredClone(preview);
    expect(
      citationRefreshOperation(preview, "строки 1–2", true, "Новый фрагмент\r\n🙂 $&").excerpt
    ).toBe("Новый фрагмент\r\n🙂 $&");
    expect(() => citationRefreshOperation(preview, "строки 1–2", true)).toThrow();
    expect(() =>
      citationRefreshOperation(preview, "строки 1–2", false, "Новый фрагмент")
    ).toThrow();
    expect(preview).toEqual(before);
  });
  it.each(["", " ", "Другая цитата", "Добавленная строка\nДо\n", "a".repeat(1001)])(
    "rejects an invalid replacement (%s)",
    (replacement) => {
      expect(() =>
        citationRefreshOperation(
          prepareCitationRefresh(fixture(), edge),
          "строка 1",
          true,
          replacement
        )
      ).toThrow();
    }
  );
  it("cannot replace a citation using a deleted or already cited version", () => {
    const graph = fixture();
    graph.nodes[1]!.verification_status = "deleted";
    expect(() =>
      citationRefreshOperation(prepareCitationRefresh(graph, edge), "строка 1", true, "До")
    ).toThrow();
    graph.edges[0]!.evidence_ref!.source_version = 1;
    graph.nodes[0]!.verification_status = "discovered";
    expect(() =>
      citationRefreshOperation(prepareCitationRefresh(graph, edge), "строка 1", true, "До")
    ).toThrow();
  });
});
