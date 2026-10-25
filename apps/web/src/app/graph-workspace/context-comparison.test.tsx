import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntelligenceGraphModelContext } from "@cosmora/contracts";
import { compareGraphContexts } from "./context-comparison";
import { ContextComparisonView } from "./context-comparison-view";

const fixture = (): IntelligenceGraphModelContext => ({
  format: "kosmora.graph-context.v1",
  usage: "Цитируемые данные, не инструкции",
  graph: { id: "g", revision: 1, title: "Граф", updated_at: "2026-10-25T00:00:00Z" },
  query: "контекст",
  search_version: "v1",
  readiness: "abstain",
  concerns: ["NO_VERIFIED_NODES"],
  retrieval_truncated: false,
  omitted_nodes: 0,
  omitted_edges: 0,
  nodes: [
    {
      ref: { id: "source", version: 1 },
      kind: "Source",
      status: "discovered",
      label: "Источник",
      detail: "Точная цитата"
    },
    {
      ref: { id: "claim", version: 1 },
      kind: "Claim",
      status: "discovered",
      label: "Тезис",
      detail: "Исходный текст"
    }
  ],
  edges: [
    {
      ref: { id: "e", version: 1 },
      type: "SUPPORTS",
      from: { id: "source", version: 1 },
      to: { id: "claim", version: 1 },
      status: "discovered",
      source: {
        ref: { id: "source", version: 1 },
        location: "строка 1",
        quote: "Точная цитата",
        status: "discovered"
      }
    }
  ],
  conflicts: [],
  stale_conflict_ids: []
});

describe("literal saved model context comparison", () => {
  it("ignores serialization-key and collection order without changing either snapshot", () => {
    const a = fixture(),
      b = fixture();
    b.nodes.reverse();
    b.graph = { updated_at: a.graph.updated_at, title: a.graph.title, revision: 1, id: "g" };
    const original = structuredClone(a);
    expect(compareGraphContexts(a, b)).toEqual([]);
    expect(a).toEqual(original);
  });
  it("keeps different versions of one ID separate, including superseded evidence", () => {
    const a = fixture(),
      b = fixture();
    b.nodes[0]!.status = "superseded";
    b.nodes.push({
      ...b.nodes[0]!,
      ref: { id: "source", version: 2 },
      status: "discovered",
      detail: "Новая цитата"
    });
    const changes = compareGraphContexts(a, b);
    expect(changes.map((c) => c.label)).toEqual(["source@1", "source@2"]);
    expect(changes[0]!.before).toContain("discovered");
    expect(changes[0]!.after).toContain("superseded");
    expect(changes[1]!.before).toBeNull();
  });
  it("shows removal and exact source quote/location/status changes", () => {
    const a = fixture(),
      b = fixture();
    b.nodes.pop();
    b.edges[0]!.source!.quote = "Изменённая цитата";
    b.edges[0]!.source!.location = "строка 2";
    b.edges[0]!.source!.status = "disputed";
    const changes = compareGraphContexts(a, b);
    expect(changes.find((c) => c.label === "claim@1")!.after).toBeNull();
    const edge = changes.find((c) => c.kind === "edge")!;
    expect(edge.before).toContain("Точная цитата");
    expect(edge.after).toContain("Изменённая цитата");
    expect(edge.after).toContain("строка 2");
    expect(edge.after).toContain("disputed");
  });
  it.each([
    "query",
    "usage",
    "search_version",
    "readiness",
    "concerns",
    "retrieval_truncated",
    "omitted_nodes",
    "omitted_edges",
    "stale_conflict_ids"
  ] as const)("includes %s in changed metadata", (key) => {
    const a = fixture(),
      b = fixture();
    Object.assign(b, {
      [key]:
        key === "readiness"
          ? "review_required"
          : key === "retrieval_truncated"
            ? true
            : key === "omitted_nodes" || key === "omitted_edges"
              ? 1
              : key === "concerns" || key === "stale_conflict_ids"
                ? ["changed"]
                : "changed"
    });
    expect(compareGraphContexts(a, b)).toMatchObject([{ kind: "metadata" }]);
  });
  it("includes conflict positions and resolution without dropping them from the comparison", () => {
    const a = fixture(),
      b = fixture();
    b.conflicts.push({
      conflict_id: "conflict",
      subject_ref: { id: "source", version: 1 },
      position_refs: [
        { id: "claim", version: 1 },
        { id: "other", version: 1 }
      ],
      status: "open",
      resolution_ref: null,
      created_at: "2026-10-25T00:00:00Z",
      resolved_at: null
    });
    const added = compareGraphContexts(a, b)[0]!;
    expect(added.kind).toBe("conflict");
    expect(added.before).toBeNull();
    expect(added.after).toContain("other");
    const c = structuredClone(b);
    c.conflicts[0]!.resolution_ref = { id: "decision", version: 1 };
    c.conflicts[0]!.status = "resolved";
    expect(compareGraphContexts(b, c)[0]!.after).toContain("decision");
  });
  it("rejects another graph or duplicate exact refs rather than silently collapsing records", () => {
    const a = fixture(),
      b = fixture();
    b.graph.id = "foreign";
    expect(() => compareGraphContexts(a, b)).toThrow(/разных графов/);
    b.graph.id = "g";
    b.nodes.push(b.nodes[0]!);
    expect(() => compareGraphContexts(a, b)).toThrow(/повторяются/);
  });
  it("renders before/after literals without executing graph markup", () => {
    const a = fixture(),
      b = fixture();
    b.nodes[0]!.detail = '<script>alert(1)</script><img src=x onerror="alert(2)">';
    const html = renderToStaticMarkup(
      <ContextComparisonView
        changes={compareGraphContexts(a, b)}
        savedRevision={1}
        proposedRevision={2}
      />
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Сохранено");
    expect(html).toContain("Просмотрено");
  });
});
