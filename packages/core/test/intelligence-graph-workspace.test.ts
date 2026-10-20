import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { IntelligenceGraphEdit } from "../src/intelligence-graph-workspace.js";
import type {
  IntelligenceGraphRevisionInfo,
  IntelligenceGraphLibraryQuery,
  IntelligenceGraphImportReceipt,
  IntelligenceGraphImportResult,
  IntelligenceGraphWorkspace,
  IntelligenceGraphWorkspaceRepository
} from "@cosmora/contracts";
import {
  IntelligenceGraphWorkspaceError,
  IntelligenceGraphWorkspaceService
} from "../src/index.js";

class MemoryRepository implements IntelligenceGraphWorkspaceRepository {
  readonly current = new Map<string, IntelligenceGraphWorkspace>();
  readonly revisions = new Map<string, IntelligenceGraphWorkspace[]>();
  private key(owner: string, project: string, graph: string) {
    return `${owner}|${project}|${graph}`;
  }
  imports = new Map<string, IntelligenceGraphImportReceipt>();
  getImportReceipt(owner: string, project: string, key: string) {
    return this.imports.get(`${owner}|${project}|${key}`) ?? null;
  }
  createImported(
    record: IntelligenceGraphWorkspace,
    key: string,
    sha256: string
  ): IntelligenceGraphImportResult | null {
    const receipt = this.getImportReceipt(record.owner_id, record.project_id, key);
    if (receipt) {
      if (receipt.package_sha256 !== sha256) return { kind: "conflict" };
      const existing = receipt.graph_id
        ? this.get(record.owner_id, record.project_id, receipt.graph_id)
        : null;
      return existing ? { kind: "replayed", graph: existing } : { kind: "deleted" };
    }
    const graph = this.create(record);
    if (!graph) return null;
    this.imports.set(`${record.owner_id}|${record.project_id}|${key}`, {
      creation_key: key,
      package_sha256: sha256,
      graph_id: graph.graph_id
    });
    return { kind: "created", graph };
  }

  create(record: IntelligenceGraphWorkspace) {
    if (record.owner_id !== "owner-a" || record.project_id !== "project-a") return null;
    const key = this.key(record.owner_id, record.project_id, record.graph_id);
    this.current.set(key, structuredClone(record));
    this.revisions.set(key, [structuredClone(record)]);
    return structuredClone(record);
  }
  get(owner: string, project: string, graph: string) {
    return structuredClone(this.current.get(this.key(owner, project, graph)) ?? null);
  }
  list(owner: string, project: string, limit: number) {
    return [...this.current.entries()]
      .filter(([key]) => key.startsWith(`${owner}|${project}|`))
      .map(([, value]) => structuredClone(value))
      .slice(0, limit);
  }
  listPage(owner: string, project: string, query: IntelligenceGraphLibraryQuery) {
    const rows = [...this.current.values()].filter(
      (g) =>
        g.owner_id === owner &&
        g.project_id === project &&
        g.title.normalize("NFC").toLocaleLowerCase("ru-RU").includes(query.query)
    );
    rows.sort((a, b) =>
      a.updated_at === b.updated_at
        ? a.graph_id < b.graph_id
          ? 1
          : a.graph_id > b.graph_id
            ? -1
            : 0
        : a.updated_at < b.updated_at
          ? 1
          : -1
    );
    const candidates = rows.filter(
      (g) =>
        !query.before ||
        g.updated_at < query.before.updated_at ||
        (g.updated_at === query.before.updated_at && g.graph_id < query.before.graph_id)
    );
    return {
      items: candidates
        .slice(0, query.limit)
        .map(({ graph_id, title, revision, created_at, updated_at }) => ({
          graph_id,
          title,
          revision,
          created_at,
          updated_at
        })),
      has_more: candidates.length > query.limit
    };
  }
  getRevision(owner: string, project: string, graph: string, revision: number) {
    return structuredClone(
      this.revisions
        .get(this.key(owner, project, graph))
        ?.find((item) => item.revision === revision) ?? null
    );
  }
  listRevisions(
    owner: string,
    project: string,
    graph: string,
    limit: number
  ): IntelligenceGraphRevisionInfo[] {
    return (this.revisions.get(this.key(owner, project, graph)) ?? [])
      .slice(-limit)
      .reverse()
      .map((item) => ({
        revision: item.revision,
        created_at: item.updated_at,
        summary: "test",
        restored_from_revision: item.restored_from_revision
      }));
  }
  save(record: IntelligenceGraphWorkspace, expected: number) {
    const key = this.key(record.owner_id, record.project_id, record.graph_id);
    if (this.current.get(key)?.revision !== expected) return null;
    this.current.set(key, structuredClone(record));
    this.revisions.get(key)?.push(structuredClone(record));
    return structuredClone(record);
  }
}

const suite = () => {
  const repository = new MemoryRepository();
  let tick = 0;
  const service = new IntelligenceGraphWorkspaceService(repository, () =>
    new Date(Date.UTC(2026, 9, 9, 0, 0, tick++)).toISOString()
  );
  return { service, repository };
};

const expectCode = (fn: () => unknown, code: IntelligenceGraphWorkspaceError["code"]) => {
  try {
    fn();
    throw new Error("Expected graph error");
  } catch (error) {
    expect(error).toBeInstanceOf(IntelligenceGraphWorkspaceError);
    expect((error as IntelligenceGraphWorkspaceError).code).toBe(code);
  }
};

describe("editable graph workspace", () => {
  it("creates/opens a genuinely empty graph; does not fabricate nodes", () => {
    const { service } = suite();
    const graph = service.create("owner-a", "project-a", "Реальная архитектура");
    expect(graph).toMatchObject({ revision: 1, nodes: [], edges: [], records: [] });
    expect(service.list("owner-a", "project-a")).toHaveLength(1);
    expect(service.get("owner-a", "project-a", graph.graph_id)).toEqual(graph);
    expect(service.revisions("owner-a", "project-a", graph.graph_id)).toHaveLength(1);
  });

  it("creates owner-entered nodes and relations, explains candidate evidence without promotion", () => {
    const { service } = suite();
    const empty = service.create("owner-a", "project-a", "Architecture");
    const first = service.edit("owner-a", "project-a", empty.graph_id, 1, {
      kind: "add_node",
      node_kind: "Claim",
      label: "Manager",
      detail: "Manual claim"
    });
    const second = service.edit("owner-a", "project-a", empty.graph_id, 2, {
      kind: "add_node",
      node_kind: "Source",
      label: "Policy",
      detail: "Manual source"
    });
    const from = { id: first.nodes[0]!.node_id, version: 1 };
    const to = { id: second.nodes[1]!.node_id, version: 1 };
    const linked = service.edit("owner-a", "project-a", empty.graph_id, 3, {
      kind: "add_edge",
      relation: "REFERENCES",
      from,
      to
    });
    expect(linked.edges).toHaveLength(1);
    expect(linked.edges[0]?.verification_status).toBe("discovered");
    expect(linked.nodes.every((item) => item.verification_status === "discovered")).toBe(true);
    const explanation = service.explain("owner-a", "project-a", empty.graph_id, "Manager");
    expect(explanation.readiness).toBe("abstain");
    expect(explanation.relationships).toEqual([
      expect.objectContaining({
        relation: "REFERENCES",
        verified: false,
        description: "Manager — ссылается на — Policy"
      })
    ]);
    expect(explanation.matched_nodes.some((item) => item.label === "Manager")).toBe(true);
    expect(explanation.explanation).toContain("Недостаточно");
  });

  it("revises an edge with immutable versions, removes and restores graph history", () => {
    const { service } = suite();
    const graph = service.create("owner-a", "project-a", "Versions");
    const a = service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "add_node",
      node_kind: "Claim",
      label: "Alpha",
      detail: "Original"
    });
    const b = service.edit("owner-a", "project-a", graph.graph_id, 2, {
      kind: "add_node",
      node_kind: "Claim",
      label: "Beta",
      detail: "Second"
    });
    const c = service.edit("owner-a", "project-a", graph.graph_id, 3, {
      kind: "add_node",
      node_kind: "Claim",
      label: "Gamma",
      detail: "Third"
    });
    const from = { id: a.nodes[0]!.node_id, version: 1 };
    const to = { id: b.nodes[1]!.node_id, version: 1 };
    const next = { id: c.nodes[2]!.node_id, version: 1 };
    const linked = service.edit("owner-a", "project-a", graph.graph_id, 4, {
      kind: "add_edge",
      relation: "SUPPORTS",
      from,
      to
    });
    const edgeId = linked.edges[0]!.edge_id;
    const changed = service.edit("owner-a", "project-a", graph.graph_id, 5, {
      kind: "revise_edge",
      edge_id: edgeId,
      from,
      to: next
    });
    expect(changed.edges.map((edge) => [edge.edge_version, edge.verification_status])).toEqual([
      [1, "superseded"],
      [2, "discovered"]
    ]);
    expect(changed.edges[1]?.supersedes).toEqual({ id: edgeId, version: 1 });
    const deleted = service.edit("owner-a", "project-a", graph.graph_id, 6, {
      kind: "remove_edge",
      edge_id: edgeId
    });
    expect(deleted.edges[1]?.verification_status).toBe("deleted");
    const restored = service.restore("owner-a", "project-a", graph.graph_id, 7, 5);
    expect(restored.revision).toBe(8);
    expect(restored.restored_from_revision).toBe(5);
    expect(restored.edges).toHaveLength(1);
    expect(restored.edges[0]?.verification_status).toBe("discovered");
    expect(service.revisions("owner-a", "project-a", graph.graph_id)).toHaveLength(8);
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, 7, {
          kind: "add_node",
          node_kind: "Entity",
          label: "stale",
          detail: "stale"
        }),
      "REVISION_CONFLICT"
    );
  });

  it("fails closed for wrong owner/project, invalid edges, input limits and foreign references", () => {
    const { service } = suite();
    const graph = service.create("owner-a", "project-a", "Owner only");
    expectCode(() => service.get("owner-b", "project-a", graph.graph_id), "NOT_FOUND");
    expectCode(() => service.get("owner-a", "project-b", graph.graph_id), "NOT_FOUND");
    expect(service.list("owner-b", "project-a")).toEqual([]);
    expectCode(() => service.create("owner-b", "project-a", "Hidden"), "NOT_FOUND");
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, 1, {
          kind: "add_edge",
          relation: "SUPPORTS",
          from: { id: "foreign", version: 1 },
          to: { id: "other", version: 1 }
        }),
      "BAD_INPUT"
    );
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, 1, {
          kind: "add_node",
          node_kind: "Claim",
          label: " ",
          detail: "valid"
        }),
      "BAD_INPUT"
    );
    expectCode(() => service.list("owner-a", "project-a", 50), "BAD_INPUT");
    expectCode(() => service.restore("owner-a", "project-a", graph.graph_id, 1, 99), "BAD_INPUT");
  });
});

describe("node revision lifecycle", () => {
  const populated = () => {
    const { service, repository } = suite();
    let graph = service.create("owner-a", "project-a", "Lifecycle");
    for (const label of ["Alpha", "Beta", "Gamma"])
      graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
        kind: "add_node",
        node_kind: "Claim",
        label,
        detail: label + " evidence"
      });
    const [a, b, c] = graph.nodes.map((n) => ({ id: n.node_id, version: n.node_version }));
    for (const [from, to] of [
      [a!, b!],
      [c!, a!]
    ])
      graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
        kind: "add_edge",
        relation: "REFERENCES",
        from: from!,
        to: to!
      });
    return { service, repository, graph, a: a! };
  };

  it("rebinds incoming and outgoing relations while retaining exact historic text", () => {
    const { service, graph, a } = populated();
    const changed = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "revise_node",
      node: a,
      label: "Новый Alpha",
      detail: "Исправлено <script> $&"
    });
    expect(
      changed.nodes.filter((n) => n.node_id === a.id).map((n) => n.verification_status)
    ).toEqual(["superseded", "discovered"]);
    expect(changed.edges.map((e) => e.verification_status)).toEqual([
      "superseded",
      "superseded",
      "discovered",
      "discovered"
    ]);
    expect(
      changed.edges.slice(2).every((e) => (e.from.id === a.id ? e.from : e.to).version === 2)
    ).toBe(true);
    expect(changed.records.find((r) => r.node.id === a.id && r.node.version === 1)?.text).toBe(
      "Alpha"
    );
    expect(changed.records.find((r) => r.node.id === a.id && r.node.version === 2)?.excerpt).toBe(
      "Исправлено <script> $&"
    );
    expect(
      service
        .explain("owner-a", "project-a", graph.graph_id, "Новый")
        .relationships.every((e) => !e.verified)
    ).toBe(true);
    expect(service.get("owner-a", "project-a", graph.graph_id).revision).toBe(graph.revision + 1);
    expect(graph.nodes[0]?.verification_status).toBe("discovered");
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, changed.revision, {
          kind: "revise_node",
          node: a,
          label: "Stale node version",
          detail: "No"
        }),
      "BAD_INPUT"
    );
  });

  it("deletes a revised node without corrupting supersession or past relations, then restores", () => {
    const { service, graph, a } = populated();
    const changed = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "revise_node",
      node: a,
      label: "Updated",
      detail: "Updated"
    });
    const deleted = service.edit("owner-a", "project-a", graph.graph_id, changed.revision, {
      kind: "remove_node",
      node: { ...a, version: 2 }
    });
    expect(
      deleted.nodes.filter((n) => n.node_id === a.id).map((n) => n.verification_status)
    ).toEqual(["superseded", "superseded", "deleted"]);
    expect(deleted.edges.map((e) => e.verification_status)).toEqual([
      "superseded",
      "superseded",
      "deleted",
      "deleted"
    ]);
    expect(
      service.explain("owner-a", "project-a", graph.graph_id, "Updated").matched_nodes
    ).toEqual([]);
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, deleted.revision, {
          kind: "remove_node",
          node: { ...a, version: 3 }
        }),
      "BAD_INPUT"
    );
    const restored = service.restore(
      "owner-a",
      "project-a",
      graph.graph_id,
      deleted.revision,
      graph.revision
    );
    expect(restored.nodes).toEqual(graph.nodes);
    expect(restored.edges).toEqual(graph.edges);
  });

  it("rolls back an oversized revision and refuses stale or cross-owner operations", () => {
    const { service, repository, graph, a } = populated();
    const before = service.get("owner-a", "project-a", graph.graph_id);
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
          kind: "revise_node",
          node: a,
          label: "x".repeat(121),
          detail: "ok"
        }),
      "BAD_INPUT"
    );
    expectCode(
      () =>
        service.edit("owner-b", "project-a", graph.graph_id, graph.revision, {
          kind: "remove_node",
          node: a
        }),
      "NOT_FOUND"
    );
    expect(service.get("owner-a", "project-a", graph.graph_id)).toEqual(before);
    const key = [...repository.current.keys()][0]!;
    const full = structuredClone(before);
    full.nodes = Array.from({ length: 150 }, (_, i) => ({
      ...before.nodes[0]!,
      node_id: "node-" + i
    }));
    full.edges = [];
    full.records = [];
    repository.current.set(key, full);
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
          kind: "revise_node",
          node: { id: "node-0", version: 1 },
          label: "Edit",
          detail: "Edit"
        }),
      "GRAPH_LIMIT"
    );
    expect(repository.current.get(key)).toEqual(full);
  });

  it("renames with CAS and rejects a clock rollback before changing history", () => {
    const { service, repository, graph } = populated();
    const renamed = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "rename",
      title: "Новое имя"
    });
    expect(renamed.title).toBe("Новое имя");
    expect(renamed.nodes).toEqual(graph.nodes);
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
          kind: "rename",
          title: "Stale"
        }),
      "REVISION_CONFLICT"
    );
    const past = new IntelligenceGraphWorkspaceService(repository, () => "2020-01-01T00:00:00Z");
    expectCode(
      () =>
        past.edit("owner-a", "project-a", graph.graph_id, renamed.revision, {
          kind: "rename",
          title: "Past"
        }),
      "BAD_INPUT"
    );
    expect(service.get("owner-a", "project-a", graph.graph_id)).toEqual(renamed);
  });
});

describe("portable workspace lifecycle", () => {
  it("exports active content, imports atomically with fresh identities and never copies verification", () => {
    const { service } = suite();
    let graph = service.create("owner-a", "project-a", "Перенос");
    for (const label of ["Тезис", "Источник"])
      graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
        kind: "add_node",
        node_kind: "Claim",
        label,
        detail: "Текст\r\nстрока"
      });
    const [a, b] = graph.nodes.map((n) => ({ id: n.node_id, version: n.node_version }));
    graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "add_edge",
      relation: "SUPPORTS",
      from: b!,
      to: a!
    });
    const first = service.exportPackage("owner-a", "project-a", graph.graph_id);
    expect(first.package.nodes).toHaveLength(2);
    expect(JSON.stringify(first.package)).not.toContain("owner-a");
    expect(JSON.stringify(first.package)).not.toContain("verification_status");
    const imported = service.importPackage("owner-a", "project-a", first.package, first.sha256);
    expect(imported.revision).toBe(1);
    expect(imported.graph_id).not.toBe(graph.graph_id);
    expect(
      imported.nodes.every(
        (n) =>
          n.verification_status === "discovered" &&
          !graph.nodes.some((g) => n.node_id === g.node_id)
      )
    ).toBe(true);
    expect(imported.edges[0]?.verification_status).toBe("discovered");
    expect(imported.nodes[0]?.source_ref.location).toContain(first.sha256);
    expect(service.exportPackage("owner-a", "project-a", imported.graph_id).package).toEqual(
      first.package
    );
    expect(service.revisions("owner-a", "project-a", imported.graph_id)).toHaveLength(1);
    const changed = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "remove_node",
      node: a!
    });
    expect(
      service.exportPackage("owner-a", "project-a", graph.graph_id).package.nodes
    ).toHaveLength(1);
    expect(
      service.exportPackage("owner-a", "project-a", graph.graph_id).package.edges
    ).toHaveLength(0);
    expect(service.exportPackage("owner-a", "project-a", graph.graph_id, graph.revision)).toEqual(
      first
    );
    expectCode(
      () => service.revision("owner-b", "project-a", graph.graph_id, graph.revision),
      "NOT_FOUND"
    );
    expectCode(
      () => service.restore("owner-a", "project-a", graph.graph_id, graph.revision, 1),
      "REVISION_CONFLICT"
    );
    expect(changed.revision).toBeGreaterThan(graph.revision);
  });

  it("rejects changed reviewed content and invalid imports before creating any graph", () => {
    const { service } = suite();
    const portable = {
      format: "kosmora.intelligence-graph.v1",
      title: "Empty",
      nodes: [],
      edges: []
    };
    const preview = service.previewImport(portable);
    expectCode(
      () =>
        service.importPackage(
          "owner-a",
          "project-a",
          { ...portable, title: "Changed" },
          preview.sha256
        ),
      "BAD_INPUT"
    );
    expectCode(
      () =>
        service.importPackage(
          "owner-a",
          "project-a",
          { ...portable, owner_id: "foreign" },
          preview.sha256
        ),
      "BAD_INPUT"
    );
    expect(service.list("owner-a", "project-a")).toEqual([]);
    expectCode(
      () => service.importPackage("owner-b", "project-a", portable, preview.sha256),
      "NOT_FOUND"
    );
    expect(service.list("owner-a", "project-a")).toEqual([]);
  });
});

describe("reviewed import receipts", () => {
  it("returns the same graph on retries, including after later edits, and rejects changed payloads", () => {
    const { service } = suite();
    const packet = service.previewImport({
      format: "kosmora.intelligence-graph.v1",
      title: "Once",
      nodes: [],
      edges: []
    });
    const key = "attempt_0123456789abcdef";
    const first = service.importPackage("owner-a", "project-a", packet.package, packet.sha256, key);
    const edited = service.edit("owner-a", "project-a", first.graph_id, 1, {
      kind: "rename",
      title: "Later"
    });
    expect(
      service.importPackage("owner-a", "project-a", packet.package, packet.sha256, key)
    ).toEqual(edited);
    expect(service.recoverImport("owner-a", "project-a", key)).toEqual({
      graph: edited,
      sha256: packet.sha256
    });
    expect(service.list("owner-a", "project-a")).toHaveLength(1);
    const other = service.previewImport({ ...packet.package, title: "Other" });
    expectCode(
      () => service.importPackage("owner-a", "project-a", other.package, other.sha256, key),
      "IMPORT_KEY_CONFLICT"
    );
    expectCode(() => service.recoverImport("owner-b", "project-a", key), "NOT_FOUND");
    expectCode(
      () => service.importPackage("owner-a", "project-a", packet.package, packet.sha256, "bad"),
      "BAD_INPUT"
    );
  });
});

describe("evidence-grounded owner citations", () => {
  const prepared = () => {
    const { service, repository } = suite();
    let graph = service.create("owner-a", "project-a", "Quoted evidence");
    for (const [label, detail, kind] of [
      ["Тезис Alpha", "First claim", "Claim"],
      ["Тезис Beta", "Second claim", "Claim"],
      ["Источник", "Начало.\r\nТочная цитата <b> $&\r\nКонец.", "Source"]
    ] as const)
      graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
        kind: "add_node",
        node_kind: kind,
        label,
        detail
      });
    const [a, b, source] = graph.nodes.map((n) => ({ id: n.node_id, version: n.node_version }));
    graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "add_edge",
      relation: "SUPPORTS",
      from: a!,
      to: b!
    });
    const edge = graph.edges[0]!.edge_id;
    return { service, repository, graph, a: a!, source: source!, edge };
  };
  it("pins exact source text/version and location while leaving evidence unverified", () => {
    const { service, graph, source, edge } = prepared();
    const quote = "\r\nТочная цитата <b> $&\r\n";
    const changed = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "cite_edge",
      edge_id: edge,
      source,
      location: "страница 4, строки 2–3",
      excerpt: quote
    });
    const cited = changed.edges.at(-1)!;
    expect(cited.evidence_ref).toEqual({
      source_id: source.id,
      source_version: 1,
      location: "страница 4, строки 2–3"
    });
    expect(cited.evidence_excerpt).toBe(quote);
    expect(cited.verification_status).toBe("discovered");
    expect(cited.supersedes).toEqual({ id: edge, version: 1 });
    const explanation = service.explain("owner-a", "project-a", graph.graph_id, "Тезис Alpha");
    expect(explanation.relationships).toContainEqual(
      expect.objectContaining({ quote, verified: false, source_status: "discovered" })
    );
    expect(
      service.revision("owner-a", "project-a", graph.graph_id, graph.revision).edges[0]
        ?.evidence_excerpt
    ).toBeUndefined();
    const restored = service.restore(
      "owner-a",
      "project-a",
      graph.graph_id,
      changed.revision,
      graph.revision
    );
    expect(restored.edges[0]?.evidence_excerpt).toBeUndefined();
  });
  it("retains quoted old source versions during portable export and imports fresh unverified content", () => {
    const { service, graph, source, edge } = prepared();
    const cited = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "cite_edge",
      edge_id: edge,
      source,
      location: "p.1",
      excerpt: "Точная цитата <b> $&"
    });
    const changed = service.edit("owner-a", "project-a", graph.graph_id, cited.revision, {
      kind: "revise_node",
      node: source,
      label: "Источник исправлен",
      detail: "Новый текст без прежней цитаты"
    });
    expect(
      service.explain("owner-a", "project-a", graph.graph_id, "Тезис Alpha").relationships.at(-1)
        ?.source_status
    ).toBe("superseded");
    const exported = service.exportPackage("owner-a", "project-a", graph.graph_id);
    expect(exported.package.nodes).toHaveLength(4);
    const evidence = exported.package.edges[0]!.evidence!;
    expect(exported.package.nodes.find((n) => n.key === evidence.source)?.detail).toContain(
      evidence.excerpt
    );
    const copied = service.importPackage("owner-a", "project-a", exported.package, exported.sha256);
    expect(copied.nodes.every((n) => n.verification_status === "discovered")).toBe(true);
    expect(copied.edges[0]?.evidence_excerpt).toBe(evidence.excerpt);
    expect(copied.edges[0]?.evidence_ref.source_id).not.toBe(source.id);
    expect(service.exportPackage("owner-a", "project-a", copied.graph_id).package).toEqual(
      exported.package
    );
    expect(changed.revision).toBe(cited.revision + 1);
  });
  it("retracts live evidence when its source is deleted, preserving history", () => {
    const { service, graph, source, edge } = prepared();
    const cited = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "cite_edge",
      edge_id: edge,
      source,
      location: "p.1",
      excerpt: "Точная цитата"
    });
    const deleted = service.edit("owner-a", "project-a", graph.graph_id, cited.revision, {
      kind: "remove_node",
      node: source
    });
    expect(deleted.edges.at(-1)?.evidence_excerpt).toBeUndefined();
    expect(deleted.edges.at(-1)?.verification_status).toBe("discovered");
    expect(
      service.revision("owner-a", "project-a", graph.graph_id, cited.revision).edges.at(-1)
        ?.evidence_excerpt
    ).toBe("Точная цитата");
    expect(
      service.exportPackage("owner-a", "project-a", graph.graph_id).package.nodes
    ).toHaveLength(2);
  });
  it("rejects fabricated/foreign/stale citations and clears reviewed quotes as a new revision", () => {
    const { service, graph, source, edge, a } = prepared();
    for (const op of [
      { source: a, excerpt: "First claim" },
      { source: { id: "foreign", version: 1 }, excerpt: "Точная цитата" },
      { source, excerpt: "Not in the source" },
      { source, excerpt: " ".repeat(1001) }
    ])
      expectCode(
        () =>
          service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
            kind: "cite_edge",
            edge_id: edge,
            location: "p.1",
            ...op
          }),
        "BAD_INPUT"
      );
    expect(service.get("owner-a", "project-a", graph.graph_id)).toEqual(graph);
    const cited = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
      kind: "cite_edge",
      edge_id: edge,
      source,
      location: "p.1",
      excerpt: "Точная цитата"
    });
    expectCode(
      () =>
        service.edit("owner-a", "project-a", graph.graph_id, graph.revision, {
          kind: "clear_edge_evidence",
          edge_id: edge
        }),
      "REVISION_CONFLICT"
    );
    const cleared = service.edit("owner-a", "project-a", graph.graph_id, cited.revision, {
      kind: "clear_edge_evidence",
      edge_id: edge
    });
    expect(cleared.edges.at(-1)?.evidence_excerpt).toBeUndefined();
    expect(cleared.edges.at(-2)?.verification_status).toBe("superseded");
  });
});

describe("scoped graph library continuation", () => {
  it("enumerates more than twenty graphs through metadata-only pages", () => {
    const { service } = suite();
    for (let i = 0; i < 45; i++) service.create("owner-a", "project-a", "Graph " + i);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = service.library("owner-a", "project-a", {
        limit: 7,
        ...(cursor ? { after: cursor } : {})
      });
      expect(page.items.length).toBeLessThanOrEqual(7);
      for (const row of page.items) {
        ids.push(row.graph_id);
        expect(Object.keys(row).sort()).toEqual([
          "created_at",
          "graph_id",
          "revision",
          "title",
          "updated_at"
        ]);
      }
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    expect(ids).toHaveLength(45);
    expect(new Set(ids).size).toBe(45);
    expect(service.library("owner-b", "project-a").items).toEqual([]);
  });
  it("orders ties by graph ID and binds cursors to owner/project/query", () => {
    const store = new MemoryRepository(),
      service = new IntelligenceGraphWorkspaceService(store, () => "2026-10-19T00:00:00.000Z");
    const created = Array.from({ length: 8 }, () =>
      service.create("owner-a", "project-a", "Ёжик history")
    );
    const expected = created
      .map((g) => g.graph_id)
      .sort()
      .reverse();
    const first = service.library("owner-a", "project-a", { limit: 3, q: "ёЖИК" });
    expect(first.items.map((g) => g.graph_id)).toEqual(expected.slice(0, 3));
    const after = first.next_cursor!;
    expect(
      service
        .library("owner-a", "project-a", { limit: 3, q: "ЁЖИК", after })
        .items.map((g) => g.graph_id)
    ).toEqual(expected.slice(3, 6));
    for (const [owner, project, q] of [
      ["owner-b", "project-a", "ёЖИК"],
      ["owner-a", "project-b", "ёЖИК"],
      ["owner-a", "project-a", "Other"]
    ])
      expectCode(() => service.library(owner!, project!, { q: q!, after }), "BAD_INPUT");
    expectCode(() => service.library("owner-a", "project-a", { after: "%%%" }), "BAD_INPUT");
    expectCode(() => service.library("owner-a", "project-a", { limit: 21 }), "BAD_INPUT");
  });
});

describe("manual conflict lifecycle", () => {
  const setupConflict = () => {
    const { service, repository } = suite();
    let graph = service.create("owner-a", "project-a", "Противоречия");
    const edit = (operation: IntelligenceGraphEdit) =>
      (graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, operation));
    for (const [node_kind, label] of [
      ["Entity", "Тема"],
      ["Claim", "Первая позиция"],
      ["Claim", "Вторая позиция"],
      ["Decision", "Старое решение"]
    ] as const)
      edit({ kind: "add_node", node_kind, label, detail: label + "\r\nТочный текст" });
    const refs = graph.nodes.map((n) => ({ id: n.node_id, version: n.node_version }));
    const open = () =>
      edit({ kind: "open_conflict", subject: refs[0]!, positions: [refs[1]!, refs[2]!] });
    const get = () => graph;
    return { service, repository, edit, refs, open, get };
  };
  it("records exact positions, a later owner decision, reopens and restores without promotion", () => {
    const { service, edit, refs, open, get } = setupConflict();
    const opened = open(),
      id = opened.conflicts![0]!.conflict_id;
    expectCode(
      () => edit({ kind: "resolve_conflict", conflict_id: id, resolution: refs[3]! }),
      "BAD_INPUT"
    );
    const withDecision = edit({
      kind: "add_node",
      node_kind: "Decision",
      label: "Обоснованное решение",
      detail: "Ручной разбор"
    });
    const resolution = { id: withDecision.nodes.at(-1)!.node_id, version: 1 };
    const resolved = edit({ kind: "resolve_conflict", conflict_id: id, resolution });
    expect(resolved.conflicts![0]).toMatchObject({
      status: "resolved",
      resolution_ref: resolution
    });
    expect(resolved.nodes.every((n) => n.verification_status === "discovered")).toBe(true);
    expectCode(() => edit({ kind: "resolve_conflict", conflict_id: id, resolution }), "BAD_INPUT");
    expect(
      service.revision("owner-a", "project-a", opened.graph_id, opened.revision).conflicts![0]!
        .status
    ).toBe("open");
    const reopened = edit({ kind: "reopen_conflict", conflict_id: id });
    expect(reopened.conflicts![0]).toMatchObject({
      status: "open",
      resolution_ref: null,
      resolved_at: null
    });
    expect(reopened.nodes).toEqual(resolved.nodes);
    expectCode(() => edit({ kind: "reopen_conflict", conflict_id: id }), "BAD_INPUT");
    const restored = service.restore(
      "owner-a",
      "project-a",
      get().graph_id,
      get().revision,
      resolved.revision
    );
    expect(restored.conflicts).toEqual(resolved.conflicts);
    expect(restored.revision).toBeGreaterThan(reopened.revision);
  });
  it("pins edited/deleted positions and blocks stale resolution until explicitly revised", () => {
    const { service, edit, refs, open, get } = setupConflict();
    const opened = open(),
      id = opened.conflicts![0]!.conflict_id;
    const withDecision = edit({
      kind: "add_node",
      node_kind: "Decision",
      label: "Решение",
      detail: "Обоснование"
    });
    const resolution = { id: withDecision.nodes.at(-1)!.node_id, version: 1 };
    edit({ kind: "revise_node", node: refs[1]!, label: "Новая позиция", detail: "Новый текст" });
    edit({ kind: "remove_node", node: refs[0]! });
    expect(get().conflicts![0]!.position_refs[0]).toEqual(refs[1]);
    const before = get();
    expectCode(() => edit({ kind: "resolve_conflict", conflict_id: id, resolution }), "BAD_INPUT");
    expect(service.get("owner-a", "project-a", before.graph_id)).toEqual(before);
    edit({
      kind: "revise_conflict",
      conflict_id: id,
      subject: refs[2]!,
      positions: [{ id: refs[1]!.id, version: 2 }, refs[2]!]
    });
    expect(
      edit({ kind: "resolve_conflict", conflict_id: id, resolution }).conflicts![0]!.status
    ).toBe("resolved");
    expectCode(
      () =>
        edit({
          kind: "revise_conflict",
          conflict_id: id,
          subject: refs[2]!,
          positions: [refs[1]!, refs[2]!]
        }),
      "BAD_INPUT"
    );
  });
  it("rejects foreign, duplicate, wrong-kind, insufficient and superseded positions atomically", () => {
    const { service, edit, refs, get } = setupConflict();
    const before = get();
    for (const positions of [
      [refs[1]!],
      [refs[1]!, refs[1]!],
      [refs[1]!, refs[3]!],
      [refs[1]!, { id: "foreign", version: 1 }],
      Array.from({ length: 21 }, () => refs[1]!)
    ])
      expectCode(() => edit({ kind: "open_conflict", subject: refs[0]!, positions }), "BAD_INPUT");
    expectCode(
      () =>
        edit({
          kind: "open_conflict",
          subject: { id: "other-graph", version: 1 },
          positions: [refs[1]!, refs[2]!]
        }),
      "BAD_INPUT"
    );
    expect(service.get("owner-a", "project-a", before.graph_id)).toEqual(before);
    edit({ kind: "revise_node", node: refs[1]!, label: "V2", detail: "New" });
    expectCode(
      () => edit({ kind: "open_conflict", subject: refs[0]!, positions: [refs[1]!, refs[2]!] }),
      "BAD_INPUT"
    );
    expectCode(
      () =>
        service.edit("owner-b", "project-a", before.graph_id, before.revision, {
          kind: "reopen_conflict",
          conflict_id: "x"
        }),
      "NOT_FOUND"
    );
  });
  it("enforces the conflict cap and stale graph CAS without adding revisions", () => {
    const { service, edit, refs, open, get } = setupConflict();
    for (let i = 0; i < 50; i++) open();
    const before = get();
    expectCode(open, "GRAPH_LIMIT");
    expect(service.get("owner-a", "project-a", before.graph_id)).toEqual(before);
    expectCode(
      () =>
        service.edit("owner-a", "project-a", before.graph_id, before.revision - 1, {
          kind: "open_conflict",
          subject: refs[0]!,
          positions: [refs[1]!, refs[2]!]
        }),
      "REVISION_CONFLICT"
    );
    expectCode(() => edit({ kind: "reopen_conflict", conflict_id: "foreign" }), "BAD_INPUT");
  });
  it("round trips pinned historical texts and resolution as newly scoped unverified content", () => {
    const { service, edit, refs, open, get } = setupConflict();
    const opened = open(),
      id = opened.conflicts![0]!.conflict_id;
    const withDecision = edit({
      kind: "add_node",
      node_kind: "Decision",
      label: "Вывод",
      detail: "Решение по цитатам"
    });
    const resolution = { id: withDecision.nodes.at(-1)!.node_id, version: 1 };
    edit({ kind: "resolve_conflict", conflict_id: id, resolution });
    edit({ kind: "remove_node", node: refs[1]! });
    edit({ kind: "revise_node", node: resolution, label: "Новый вывод", detail: "Другая версия" });
    const exported = service.exportPackage("owner-a", "project-a", get().graph_id);
    expect(exported.package.conflicts).toHaveLength(1);
    const conflict = exported.package.conflicts![0]!;
    expect(exported.package.nodes.find((n) => n.key === conflict.positions[0])?.label).toBe(
      "Первая позиция"
    );
    expect(exported.package.nodes.find((n) => n.key === conflict.resolution)?.label).toBe("Вывод");
    const imported = service.importPackage(
      "owner-a",
      "project-a",
      exported.package,
      exported.sha256,
      "conflict_roundtrip_key_1"
    );
    expect(imported.graph_id).not.toBe(get().graph_id);
    expect(imported.conflicts![0]!.conflict_id).not.toBe(id);
    expect(imported.conflicts![0]!.status).toBe("resolved");
    expect(imported.nodes.every((n) => n.verification_status === "discovered")).toBe(true);
    expect(imported.nodes.some((n) => get().nodes.some((old) => old.node_id === n.node_id))).toBe(
      false
    );
    const replayed = service.importPackage(
      "owner-a",
      "project-a",
      exported.package,
      exported.sha256,
      "conflict_roundtrip_key_1"
    );
    expect(replayed).toEqual(imported);
    const changed = structuredClone(exported.package);
    changed.conflicts![0]!.resolution = null;
    expectCode(
      () => service.importPackage("owner-a", "project-a", changed, exported.sha256),
      "BAD_INPUT"
    );
  });
});

describe("conflict-aware revision readings", () => {
  it("finds exact source-body text, follows its candidate relation and includes the search version in reports", () => {
    const { service } = suite();
    let graph = service.create("owner-a", "project-a", "Поиск по источникам");
    const edit = (operation: IntelligenceGraphEdit) =>
      (graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, operation));
    edit({
      kind: "add_node",
      node_kind: "Source",
      label: "Приложение 7",
      detail: "Квантовый протокол\r\nТочная строка"
    });
    edit({ kind: "add_node", node_kind: "Claim", label: "Нагрузка", detail: "Нужно измерение" });
    const from = { id: graph.nodes[0]!.node_id, version: 1 },
      to = { id: graph.nodes[1]!.node_id, version: 1 };
    edit({ kind: "add_edge", relation: "SUPPORTS", from, to });
    edit({
      kind: "cite_edge",
      edge_id: graph.edges[0]!.edge_id,
      source: from,
      location: "строка 1",
      excerpt: "Квантовый протокол"
    });
    const reading = service.explain("owner-a", "project-a", graph.graph_id, "КВАНТОВЫЙ");
    expect(reading.matched_nodes.map((n) => n.label)).toContain("Приложение 7");
    expect(reading.relationships[0]).toMatchObject({
      quote: "Квантовый протокол",
      verified: false
    });
    expect(reading.matched_nodes.find((n) => n.id === from.id)!.detail).toBe(
      "Квантовый протокол\r\nТочная строка"
    );
    expect(reading.budget).toMatchObject({ matched_candidates: 1, unreturned_candidates: 0 });
    expect(reading.search_version).toBe("title-and-saved-text-v2");
    expect(
      service.report("owner-a", "project-a", graph.graph_id, "КВАНТОВЫЙ", graph.revision).report
        .reading
    ).toEqual(reading);
    expect(reading.readiness).toBe("abstain");
  });
  const packet = () => ({
    format: "kosmora.intelligence-graph.v1",
    title: "Точное чтение",
    nodes: [
      { key: "topic", kind: "Entity", label: "Архитектура", detail: "Тема" },
      {
        key: "a",
        kind: "Claim",
        label: "Архитектура: позиция A",
        detail: "Исходная позиция\r\nТочная строка"
      },
      { key: "b", kind: "Claim", label: "Конкурирующая позиция", detail: "<script> $&" },
      { key: "d", kind: "Decision", label: "Решение", detail: "Ручное обоснование" }
    ],
    edges: [],
    conflicts: [{ subject: "topic", positions: ["a", "b"], resolution: null as string | null }]
  });
  const fixture = () => {
    const { service, repository } = suite();
    const p = packet();
    const preview = service.previewImport(p);
    const graph = service.importPackage("owner-a", "project-a", p, preview.sha256);
    return { service, repository, graph };
  };
  it("returns all pinned positions when only one side matches and never upgrades evidence", () => {
    const { service, graph } = fixture();
    const reading = service.explain("owner-a", "project-a", graph.graph_id, "Архитектура");
    expect(reading.conflicts).toHaveLength(1);
    expect(reading.conflict_nodes.map((n) => n.label)).toContain("Конкурирующая позиция");
    expect(reading.conflict_nodes.map((n) => n.detail)).toContain("<script> $&");
    expect(reading.conflict_review).toMatchObject({ relevant: 1, returned: 1, truncated: false });
    expect(reading.concerns).toContain("OPEN_CONFLICTS");
    expect(reading.readiness).toBe("abstain");
    expect(reading.query).toBe("Архитектура");
    expect(reading.matched_nodes.every((n) => n.status === "discovered")).toBe(true);
  });
  it("finds pinned historical text after deletion and reports stale versions", () => {
    const { service, graph } = fixture();
    const a = graph.nodes[1]!;
    const changed = service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "remove_node",
      node: { id: a.node_id, version: 1 }
    });
    const reading = service.explain("owner-a", "project-a", graph.graph_id, "Исходная");
    expect(reading.matched_nodes).toHaveLength(0);
    expect(reading.conflicts).toHaveLength(1);
    expect(reading.stale_conflict_ids).toEqual([changed.conflicts![0]!.conflict_id]);
    expect(reading.conflict_nodes.find((n) => n.ref.id === a.node_id)).toMatchObject({
      status: "superseded",
      detail: "Исходная позиция\r\nТочная строка"
    });
    expect(reading.concerns).toContain("STALE_CONFLICTS");
    expect(
      service.explain("owner-a", "project-a", graph.graph_id, "Несвязанный запрос").conflicts
    ).toEqual([]);
  });
  it("requires review for an open conflict even when upstream nodes passed independent verification", () => {
    const { service, repository, graph } = fixture();
    const stored = repository.current.get(`owner-a|project-a|${graph.graph_id}`)!;
    for (const n of stored.nodes) {
      n.verification_status = "verified";
      n.provenance_kind = "human_verification";
      n.confidence_method = "human_review";
    }
    const conflicts = stored.conflicts;
    stored.conflicts = [];
    expect(service.explain("owner-a", "project-a", graph.graph_id, "Архитектура").readiness).toBe(
      "grounded_context"
    );
    if (conflicts) stored.conflicts = conflicts;
    else delete stored.conflicts;
    const reading = service.explain("owner-a", "project-a", graph.graph_id, "Архитектура");
    expect(reading.readiness).toBe("review_required");
    expect(reading.concerns).toContain("OPEN_CONFLICTS");
    expect(stored.nodes.every((n) => n.verification_status === "verified")).toBe(true);
  });
  it("pins exact query/revision report bytes across later edits and rejects foreign/future revisions", () => {
    const { service, graph } = fixture();
    const first = service.report("owner-a", "project-a", graph.graph_id, "  Архитектура  ", 1);
    service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "rename",
      title: "Новое название"
    });
    expect(service.report("owner-a", "project-a", graph.graph_id, "Архитектура", 1)).toEqual(first);
    expect(first.report).toMatchObject({
      format: "kosmora.intelligence-graph-report.v1",
      reading: { revision: 1, graph_title: "Точное чтение", query: "Архитектура" }
    });
    expect(
      service.report("owner-a", "project-a", graph.graph_id, "Архитектура", 2).sha256
    ).not.toBe(first.sha256);
    expect(
      service.report("owner-a", "project-a", graph.graph_id, "Конкурирующая", 1).sha256
    ).not.toBe(first.sha256);
    expect(JSON.stringify(first)).not.toContain("owner-a");
    expect(first.sha256).toBe(
      createHash("sha256").update(JSON.stringify(first.report)).digest("hex")
    );
    expectCode(
      () => service.report("owner-b", "project-a", graph.graph_id, "Архитектура", 1),
      "NOT_FOUND"
    );
    expectCode(
      () => service.report("owner-a", "project-a", graph.graph_id, "Архитектура", 3),
      "BAD_INPUT"
    );
  });
  it("keeps resolved decisions as organizational context and flags a superseded decision", () => {
    const { service } = suite();
    const p = packet();
    p.conflicts[0]!.resolution = "d";
    const preview = service.previewImport(p),
      graph = service.importPackage("owner-a", "project-a", p, preview.sha256);
    const clean = service.explain("owner-a", "project-a", graph.graph_id, "Архитектура");
    expect(clean.concerns).not.toContain("OPEN_CONFLICTS");
    expect(clean.conflicts[0]!.resolution_ref).not.toBeNull();
    expect(clean.readiness).toBe("abstain");
    const decision = graph.nodes[3]!;
    service.edit("owner-a", "project-a", graph.graph_id, 1, {
      kind: "revise_node",
      node: { id: decision.node_id, version: 1 },
      label: "Новое решение",
      detail: "Новый текст"
    });
    const stale = service.explain("owner-a", "project-a", graph.graph_id, "Архитектура");
    expect(stale.concerns).toContain("STALE_CONFLICTS");
    expect(stale.conflict_nodes.find((n) => n.ref.id === decision.node_id)!.detail).toBe(
      "Ручное обоснование"
    );
    expect(service.explain("owner-a", "project-a", graph.graph_id, "Архитектура", 1)).toEqual(
      clean
    );
  });
  it("bounds conflict count, preserves complete sides and deduplicates repeated node texts", () => {
    const { service } = suite();
    const p = packet();
    p.conflicts = Array.from({ length: 12 }, () => ({ ...p.conflicts[0]! }));
    const preview = service.previewImport(p),
      graph = service.importPackage("owner-a", "project-a", p, preview.sha256);
    const reading = service.explain("owner-a", "project-a", graph.graph_id, "Архитектура");
    expect(reading.conflict_review).toMatchObject({
      relevant: 12,
      returned: 10,
      returned_nodes: 3,
      truncated: true
    });
    expect(reading.conflicts.every((c) => c.position_refs.length === 2)).toBe(true);
    expect(reading.concerns).toContain("TRUNCATED_CONFLICT_REVIEW");
    expect(reading.truncated).toBe(true);
  });
  it("limits unique context nodes without returning half a conflict or omitting its decision", () => {
    const { service } = suite();
    const nodes = Array.from({ length: 84 }, (_, i) => ({
      key: "n" + i,
      kind: i % 21 === 20 ? "Decision" : "Claim",
      label: "Общая тема " + i,
      detail: "Текст " + i
    }));
    const conflicts = Array.from({ length: 4 }, (_, group) => ({
      subject: "n" + group * 21,
      positions: Array.from({ length: 20 }, (_, i) => "n" + (group * 21 + i)),
      resolution: "n" + (group * 21 + 20)
    }));
    const p = {
      format: "kosmora.intelligence-graph.v1",
      title: "Лимиты",
      nodes,
      edges: [],
      conflicts
    };
    const preview = service.previewImport(p),
      graph = service.importPackage("owner-a", "project-a", p, preview.sha256);
    const reading = service.explain("owner-a", "project-a", graph.graph_id, "Общая");
    expect(reading.conflict_nodes).toHaveLength(42);
    expect(reading.conflict_review).toMatchObject({
      relevant: 4,
      returned: 2,
      truncated: true,
      max_nodes: 60
    });
    for (const c of reading.conflicts) {
      expect(c.position_refs).toHaveLength(20);
      expect(reading.conflict_nodes.some((n) => n.ref.id === c.resolution_ref!.id)).toBe(true);
      expect(
        c.position_refs.every((p) =>
          reading.conflict_nodes.some((n) => n.ref.id === p.id && n.ref.version === p.version)
        )
      ).toBe(true);
    }
  });
});

it.each([false, true])(
  "never reuses published node/edge version identities after restore plus rename (legacy=%s)",
  (legacy) => {
    const { service, repository } = suite();
    let graph = service.create("owner-a", "project-a", "Lineage");
    const edit = (operation: IntelligenceGraphEdit) =>
      (graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, operation));
    edit({ kind: "add_node", node_kind: "Source", label: "A", detail: "Exact A" });
    edit({ kind: "add_node", node_kind: "Claim", label: "B", detail: "Exact B" });
    const a = { id: graph.nodes[0]!.node_id, version: 1 },
      b = { id: graph.nodes[1]!.node_id, version: 1 };
    edit({ kind: "add_edge", relation: "SUPPORTS", from: a, to: b });
    const initialRevision = graph.revision,
      edgeId = graph.edges[0]!.edge_id;
    const branch = edit({ kind: "revise_node", node: a, label: "Branch A", detail: "Branch text" });
    graph = service.restore(
      "owner-a",
      "project-a",
      graph.graph_id,
      graph.revision,
      initialRevision
    );
    edit({ kind: "rename", title: "Intervening rename" });
    if (legacy) delete repository.current.get(`owner-a|project-a|${graph.graph_id}`)!.version_floor;
    const changed = edit({ kind: "revise_node", node: a, label: "Other A", detail: "Other text" });
    const newNode = changed.nodes.find(
      (n) => n.node_id === a.id && n.verification_status === "discovered"
    )!;
    const priorNode = branch.nodes.find(
      (n) => n.node_id === a.id && n.verification_status === "discovered"
    )!;
    expect(newNode.node_version).toBeGreaterThan(priorNode.node_version);
    const nextEdge = changed.edges.find(
      (e) => e.edge_id === edgeId && e.verification_status === "discovered"
    )!;
    const priorEdge = branch.edges.find(
      (e) => e.edge_id === edgeId && e.verification_status === "discovered"
    )!;
    expect(nextEdge.edge_version).toBeGreaterThan(priorEdge.edge_version);
    expect(nextEdge.from).toEqual({ id: a.id, version: newNode.node_version });
    expect(service.revision("owner-a", "project-a", graph.graph_id, branch.revision)).toEqual(
      branch
    );
  }
);

it("retains a fresh allocation floor through multiple restores and every relation evidence mutation", () => {
  const { service } = suite();
  const input = {
    format: "kosmora.intelligence-graph.v1",
    title: "Lineage evidence",
    nodes: [
      { key: "s", kind: "Source", label: "Source", detail: "Exact quote" },
      { key: "a", kind: "Claim", label: "A", detail: "A detail" },
      { key: "b", kind: "Claim", label: "B", detail: "B detail" }
    ],
    edges: [
      {
        relation: "SUPPORTS",
        from: "a",
        to: "b",
        evidence: { source: "s", location: "line 1", excerpt: "Exact quote" }
      }
    ]
  };
  const preview = service.previewImport(input);
  let graph = service.importPackage("owner-a", "project-a", input, preview.sha256);
  const initialHash = service.exportPackage("owner-a", "project-a", graph.graph_id).sha256;
  const source = { id: graph.nodes[0]!.node_id, version: 1 },
    a = { id: graph.nodes[1]!.node_id, version: 1 },
    b = { id: graph.nodes[2]!.node_id, version: 1 },
    edgeId = graph.edges[0]!.edge_id;
  const edit = (operation: IntelligenceGraphEdit) =>
    (graph = service.edit("owner-a", "project-a", graph.graph_id, graph.revision, operation));
  edit({ kind: "clear_edge_evidence", edge_id: edgeId });
  edit({
    kind: "cite_edge",
    edge_id: edgeId,
    source,
    location: "other line",
    excerpt: "Exact quote"
  });
  graph = service.restore("owner-a", "project-a", graph.graph_id, graph.revision, 1);
  const floor = graph.version_floor!;
  edit({ kind: "remove_node", node: source });
  expect(graph.nodes.at(-1)!.node_version).toBeGreaterThanOrEqual(floor);
  expect(graph.edges.at(-1)!.edge_version).toBeGreaterThanOrEqual(floor);
  expect(graph.edges.at(-1)!.evidence_excerpt).toBeUndefined();
  graph = service.restore("owner-a", "project-a", graph.graph_id, graph.revision, 1);
  expect(graph.version_floor).toBeGreaterThan(floor);
  edit({ kind: "revise_edge", edge_id: edgeId, from: b, to: a });
  edit({ kind: "cite_edge", edge_id: edgeId, source, location: "line 1", excerpt: "Exact quote" });
  edit({ kind: "clear_edge_evidence", edge_id: edgeId });
  const nodeContents = new Map<string, string>(),
    edgeContents = new Map<string, string>();
  for (let revision = 1; revision <= graph.revision; revision++) {
    const snapshot = service.revision("owner-a", "project-a", graph.graph_id, revision);
    for (const r of snapshot.records) {
      const key = `${r.node.id}@${r.node.version}`,
        content = JSON.stringify([r.text, r.excerpt]);
      if (nodeContents.has(key)) expect(content).toBe(nodeContents.get(key));
      nodeContents.set(key, content);
    }
    for (const e of snapshot.edges) {
      const key = `${e.edge_id}@${e.edge_version}`,
        content = JSON.stringify([e.from, e.to, e.type, e.evidence_ref, e.evidence_excerpt]);
      if (edgeContents.has(key)) expect(content).toBe(edgeContents.get(key));
      edgeContents.set(key, content);
    }
  }
  expect(service.exportPackage("owner-a", "project-a", graph.graph_id, 1).sha256).toBe(initialHash);
  const exported = service.exportPackage("owner-a", "project-a", graph.graph_id);
  expect(Object.hasOwn(exported.package, "version_floor")).toBe(false);
});

it("rejects restore clock rollback without moving the library order or appending history", () => {
  const repository = new MemoryRepository();
  let now = "2026-10-19T00:00:00.000Z";
  const service = new IntelligenceGraphWorkspaceService(repository, () => now);
  const first = service.create("owner-a", "project-a", "Clock");
  now = "2026-10-19T00:00:02.000Z";
  const changed = service.edit("owner-a", "project-a", first.graph_id, 1, {
    kind: "rename",
    title: "Later"
  });
  now = "2026-10-19T00:00:01.000Z";
  expectCode(() => service.restore("owner-a", "project-a", first.graph_id, 2, 1), "BAD_INPUT");
  expect(service.get("owner-a", "project-a", first.graph_id)).toEqual(changed);
  expect(service.revisions("owner-a", "project-a", first.graph_id)).toHaveLength(2);
});

it.each(["invalid", "2026-02-30T00:00:00.000Z", "2026-10-19"])(
  "rejects invalid workspace clocks before persisting empty graphs or imports: %s",
  (at) => {
    const repository = new MemoryRepository(),
      service = new IntelligenceGraphWorkspaceService(repository, () => at);
    expectCode(() => service.create("owner-a", "project-a", "Clock"), "BAD_INPUT");
    const input = { format: "kosmora.intelligence-graph.v1", title: "Empty", nodes: [], edges: [] };
    const preview = service.previewImport(input);
    expectCode(
      () => service.importPackage("owner-a", "project-a", input, preview.sha256),
      "BAD_INPUT"
    );
    expect(repository.current.size).toBe(0);
  }
);

it.each(["current", "historical"])(
  "rejects corrupt %s allocator state before restoring metadata over it",
  (where) => {
    const { service, repository } = suite();
    const first = service.create("owner-a", "project-a", "Integrity");
    const changed = service.edit("owner-a", "project-a", first.graph_id, 1, {
      kind: "rename",
      title: "Later"
    });
    const key = `owner-a|project-a|${first.graph_id}`;
    if (where === "current") repository.current.get(key)!.version_floor = 1000;
    else repository.revisions.get(key)![0]!.version_floor = 1000;
    const before = service.get("owner-a", "project-a", first.graph_id);
    expectCode(
      () => service.restore("owner-a", "project-a", first.graph_id, changed.revision, 1),
      "BAD_INPUT"
    );
    expect(service.get("owner-a", "project-a", first.graph_id)).toEqual(before);
    expect(service.revisions("owner-a", "project-a", first.graph_id)).toHaveLength(2);
  }
);
