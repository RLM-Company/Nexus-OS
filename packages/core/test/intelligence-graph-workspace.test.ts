import { describe, expect, it } from "vitest";
import type {
  IntelligenceGraphRevisionInfo,
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
